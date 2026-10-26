import Table from 'cli-table3';
import pc from 'picocolors';
import { PLAY_POLICY } from '../rules/index.js';
import type { Report, Severity } from '../types.js';
import { ELF_FIX, googleCheck, plural, problemText, scopeText, summarizeApk, verdictText } from './apkSummary.js';
import { PLAY_CONSOLE_HINT, playStoreSection } from './playStoreSection.js';
import {
  NATIVE_STATUS_LABEL,
  SIXTEEN_KB_NOT_CHECKED,
  dataSources,
  groupFindings,
  headline,
  interestingDependencies,
  maintenanceLabel,
  nativeSections,
  newArchLabel,
  sixteenKbNotChecked,
  subtitle,
  templateColumns,
} from './shared.js';

export function renderTerminal(report: Report, options: { color: boolean }): string {
  const c = pc.createColors(options.color);
  const icon: Record<Severity, string> = { blocker: c.red('✖'), warning: c.yellow('▲'), info: c.blue('ℹ') };
  const out: string[] = [];

  out.push('', c.bold(`rn-upgrade-doctor · ${headline(report)}`));
  out.push(c.dim(subtitle(report)));
  if (report.meta.upgradeHelperUrl) out.push(`Upgrade diff: ${c.cyan(report.meta.upgradeHelperUrl)}`);

  const { blockers, warnings, info } = report.summary;
  out.push(
    '',
    `${c.red(c.bold(`${blockers} blocker${blockers === 1 ? '' : 's'}`))}  ${c.yellow(`${warnings} warning${warnings === 1 ? '' : 's'}`)}  ${c.blue(`${info} info`)}`,
  );

  if (report.findings.length > 0) {
    out.push('', c.bold('What to fix first'));
    groupFindings(report.findings).forEach((group, i) => {
      const n = `${String(i + 1).padStart(3)}.`;
      if (group.findings.length === 1) {
        const f = group.findings[0];
        out.push(`${n} ${icon[f.severity]} ${f.title}`);
        if (f.detail) out.push(c.dim(`       ${oneLine(f.detail)}`));
        if (f.fix) out.push(`       ${c.green('→')} ${f.fix}`);
        if (f.docs) out.push(c.dim(`       docs: ${f.docs}`));
        out.push(c.dim(`       source: ${f.source}`));
        return;
      }
      out.push(`${n} ${icon[group.severity]} ${c.bold(group.package!)}: ${group.findings.length} problems`);
      for (const f of group.findings) {
        out.push(`       ${icon[f.severity]} ${f.title}`);
        if (f.detail) out.push(c.dim(`         ${oneLine(f.detail)}`));
        if (f.fix) out.push(`         ${c.green('→')} ${f.fix}`);
        if (f.docs) out.push(c.dim(`         docs: ${f.docs}`));
        out.push(c.dim(`         source: ${f.source}`));
      }
    });
  }

  const deps = interestingDependencies(report);
  if (deps.length > 0) {
    const table = new Table({
      head: ['Package', 'Installed', 'Latest', 'New Arch', 'Maintenance'],
      style: { head: options.color ? ['cyan'] : [], border: options.color ? ['grey'] : [] },
    });
    for (const d of deps) {
      const outdated = d.installed && d.npm.value && d.installed !== d.npm.value.latest;
      table.push([
        d.name + (d.dev ? c.dim(' (dev)') : ''),
        d.installed ?? c.dim(d.declared),
        d.npm.value ? (outdated ? c.yellow(d.npm.value.latest) : d.npm.value.latest) : c.dim('?'),
        colorStatus(newArchLabel(d), c),
        colorStatus(maintenanceLabel(d), c),
      ]);
    }
    out.push('', c.bold(`Dependencies to review (${deps.length} of ${report.dependencies.length})`), table.toString());
  }

  const columns = templateColumns(report);
  if (report.meta.mode !== 'apk-only') out.push('', c.bold('Native config vs React Native template'));
  for (const section of report.meta.mode === 'apk-only' ? [] : nativeSections(report)) {
    if (section.rows.length === 0) {
      out.push(`  ${section.platform}: ${c.dim(`no ${section.platform === 'Android' ? 'android/' : 'ios/Podfile'} found`)}`);
      continue;
    }
    const table = new Table({
      head: [`${section.platform}`, 'Yours', ...columns.map((col) => col.title), 'Status'],
      style: { head: options.color ? ['cyan'] : [], border: options.color ? ['grey'] : [] },
    });
    for (const row of section.rows) {
      const label = NATIVE_STATUS_LABEL[row.status];
      const status = row.status === 'below-required' ? c.red(label) : label.startsWith('▲') ? c.yellow(label) : label.startsWith('✓') ? c.green(label) : c.dim(label);
      table.push([row.label, row.yours.startsWith('not') ? c.dim(row.yours) : row.yours, ...columns.map((col) => row[col.key] ?? c.dim('–')), status]);
    }
    out.push(c.dim(`  ${section.files.join(', ')}`), table.toString());
  }

  const apk = summarizeApk(report);
  if (apk) {
    const verdict = verdictText(apk);
    out.push('', `${c.bold('16 KB page size')}  ${apk.ok ? c.green(`✓ ${verdict}`) : c.red(`✖ ${verdict}`)}`, c.dim(`  ${scopeText(apk)}`));
    if (!apk.ok) {
      const count = (n: number) => String(n).padStart(String(apk.total).length);
      out.push('', `  ${c.green('✓')} ${count(apk.ready)} ${plural(apk.ready, 'library', 'libraries')} ready`);
      if (apk.zipOnly > 0) {
        out.push(`  ${c.red('✖')} ${count(apk.zipOnly)} stored without 16 KB zip alignment`);
        out.push(`  ${' '.repeat(String(apk.total).length + 3)}${c.green('→')} One build fix for all: ${PLAY_POLICY.zipAlignFix}`);
      }
      if (apk.elf > 0) {
        out.push(`  ${c.red('✖')} ${count(apk.elf)} built with 4 KB ELF segments`);
        out.push(`  ${' '.repeat(String(apk.total).length + 3)}${c.green('→')} ${ELF_FIX}`);
      }
      const width = Math.max(...apk.byPackage.map((g) => (g.package ?? 'unknown package').length));
      out.push('', '  By package (details in "What to fix first"):');
      for (const g of apk.byPackage) {
        const libs = `${g.libs.length} ${plural(g.libs.length, 'library', 'libraries')}`.padEnd(13);
        const names = g.package ? '' : `: ${g.libs.join(', ')}`;
        out.push(`    ${(g.package ?? 'unknown package').padEnd(width)}  ${libs}  ${problemText(g.problems)}${names}`);
      }
    }
    const check = googleCheck(apk);
    if (check) out.push('', c.dim(`  Check with Google's tool (Android SDK build-tools): ${check}`));
  } else if (sixteenKbNotChecked(report)) {
    out.push('', c.bold('16 KB page size'), c.yellow(SIXTEEN_KB_NOT_CHECKED));
  }

  const play = playStoreSection(report);
  if (play) {
    out.push('', `${c.bold('Play Store ready?')}  ${play.verdict.ready ? c.green(play.heading) : c.red(play.heading)}`);
    if (play.app) out.push(c.dim(`  ${play.app}`));
    for (const line of play.signedWith) out.push(c.dim(`  signed: ${line}`));
    for (const sha of play.fingerprints) out.push(c.dim(`  SHA-256 ${sha} (${PLAY_CONSOLE_HINT})`));
    if (play.issues.length > 0) out.push('');
    for (const f of play.issues) {
      out.push(`  ${icon[f.severity]} ${f.title}`);
      if (f.fix) out.push(`      ${c.green('→')} ${f.fix}`);
      if (f.docs) out.push(c.dim(`        ${f.docs}`));
    }
    for (const f of play.notes) out.push(c.dim(`  ${icon.info} ${f.title}`));
  }

  out.push('', c.dim('Data sources:'), ...dataSources(report).map((s) => c.dim(`  ${s}`)), '');
  return out.join('\n');
}

function colorStatus(label: string, c: ReturnType<typeof pc.createColors>): string {
  if (label === 'no' || label === 'deprecated' || label === 'unmaintained') return c.red(label);
  if (label === 'untested') return c.yellow(label);
  if (label.startsWith('yes') || label === 'ok') return c.green(label);
  return c.dim(label);
}

/** npm deprecation messages can span several lines; keep the terminal layout intact. */
function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, ' ').trim();
}
