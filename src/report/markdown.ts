import { PLAY_POLICY } from '../rules/index.js';
import type { Report, Severity } from '../types.js';
import { ELF_FIX, googleCheck, plural, problemText, scopeText, summarizeApk, verdictText } from './apkSummary.js';
import { PLAY_CONSOLE_HINT, playStoreSection } from './playStoreSection.js';
import {
  NATIVE_STATUS_LABEL,
  SEVERITY_LABEL,
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

const ICON: Record<Severity, string> = { blocker: '🔴', warning: '🟡', info: '🔵' };

export function renderMarkdown(report: Report): string {
  const out: string[] = [];
  const { blockers, warnings, info } = report.summary;

  out.push(`## rn-upgrade-doctor: ${headline(report)}`, '');
  if (report.meta.mode === 'apk-only') out.push(`\`${subtitle(report)}\``, '');
  out.push(`**${blockers} blockers** · ${warnings} warnings · ${info} info`, '');
  if (report.meta.upgradeHelperUrl) out.push(`Upgrade diff: ${report.meta.upgradeHelperUrl}`, '');

  if (report.findings.length > 0) {
    out.push('### What to fix first', '', '| # | Severity | Finding | Fix | Source |', '|---|---|---|---|---|');
    groupFindings(report.findings).forEach((group, i) => {
      group.findings.forEach((f, j) => {
        const finding = f.detail ? `**${cell(f.title)}**<br>${cell(f.detail)}` : `**${cell(f.title)}**`;
        // Later findings for the same package share the number of the first one.
        const fix = [f.fix ? cell(f.fix) : '', f.docs ? `[docs](${f.docs})` : ''].filter(Boolean).join(' ');
        out.push(`| ${j === 0 ? i + 1 : '↳'} | ${ICON[f.severity]} ${SEVERITY_LABEL[f.severity]} | ${finding} | ${fix} | ${cell(f.source)} |`);
      });
    });
    out.push('');
  }

  const deps = interestingDependencies(report);
  if (deps.length > 0) {
    out.push(
      `### Dependencies to review (${deps.length} of ${report.dependencies.length})`,
      '',
      '| Package | Installed | Latest | New Arch | Maintenance |',
      '|---|---|---|---|---|',
    );
    for (const d of deps) {
      out.push(
        `| ${cell(d.name)}${d.dev ? ' (dev)' : ''} | ${cell(d.installed ?? d.declared)} | ${cell(d.npm.value?.latest ?? '?')} | ${newArchLabel(d)} | ${maintenanceLabel(d)} |`,
      );
    }
    out.push('');
  }

  const columns = templateColumns(report);
  if (report.meta.mode !== 'apk-only') out.push('### Native config vs React Native template', '');
  for (const section of report.meta.mode === 'apk-only' ? [] : nativeSections(report)) {
    if (section.rows.length === 0) {
      out.push(`**${section.platform}:** not found`, '');
      continue;
    }
    out.push(
      `**${section.platform}** (${section.files.map((f) => `\`${f}\``).join(', ')})`,
      '',
      `| Setting | Yours | ${columns.map((col) => col.title).join(' | ')} | Status |`,
      `|---|---|${columns.map(() => '---|').join('')}---|`,
    );
    for (const row of section.rows) {
      out.push(`| ${cell(row.label)} | ${cell(row.yours)} | ${columns.map((col) => cell(row[col.key] ?? '–')).join(' | ')} | ${NATIVE_STATUS_LABEL[row.status]} |`);
    }
    out.push('');
  }

  const apk = summarizeApk(report);
  if (apk) {
    out.push(`### 16 KB page size: ${apk.ok ? '✅' : '❌'} ${verdictText(apk)}`, '', scopeText(apk).replace(apk.file, `\`${apk.file}\``), '');
    if (!apk.ok) {
      out.push(`- ✅ ${apk.ready} ${plural(apk.ready, 'library', 'libraries')} ready`);
      if (apk.zipOnly > 0) out.push(`- ❌ ${apk.zipOnly} stored without 16 KB zip alignment. **One build fix for all:** ${PLAY_POLICY.zipAlignFix}`);
      if (apk.elf > 0) out.push(`- ❌ ${apk.elf} built with 4 KB ELF segments. ${ELF_FIX}`);
      out.push('', '| Package | Libraries | Problem |', '|---|---|---|');
      for (const g of apk.byPackage) {
        const libs = g.package ? String(g.libs.length) : `${g.libs.length}: ${g.libs.map((n) => `\`${n}\``).join(', ')}`;
        out.push(`| ${cell(g.package ?? 'unknown package')} | ${libs} | ${problemText(g.problems)} |`);
      }
      out.push('');
    }
    const libs = report.apk!.libs.filter((l) => l.is64Bit);
    out.push(`<details><summary>All ${libs.length} 64-bit library files</summary>`, '', '| Library | ABI | Package | ELF align | Zip aligned |', '|---|---|---|---|---|');
    for (const l of libs) {
      const align = l.loadAlign === undefined ? '?' : `${l.loadAlign / 1024} KB`;
      const zip = l.zipAligned === undefined ? '–' : l.zipAligned ? 'yes' : '**no**';
      out.push(`| ${cell(l.name)} | ${l.abi} | ${cell(l.package ?? '?')} | ${l.elfOk ? align : `**${align}**`} | ${zip} |`);
    }
    out.push('', '</details>', '');
    const check = googleCheck(apk);
    if (check) out.push(`Check with Google's tool (Android SDK build-tools): \`${check}\``, '');
  } else if (sixteenKbNotChecked(report)) {
    out.push('### 16 KB page size', '', SIXTEEN_KB_NOT_CHECKED.replace('--apk', '`--apk`'), '');
  }

  const play = playStoreSection(report);
  if (play) {
    out.push(`### Play Store ready? ${play.heading}`, '');
    if (play.app) out.push(`\`${play.app}\``, '');
    for (const line of play.signedWith) out.push(`Signed: ${cell(line)}  `);
    for (const sha of play.fingerprints) out.push(`SHA-256 \`${sha}\` (${PLAY_CONSOLE_HINT})  `);
    if (play.signedWith.length > 0) out.push('');
    for (const f of play.issues) {
      out.push(`- ${f.severity === 'blocker' ? '❌' : '⚠️'} **${cell(f.title)}**${f.fix ? ` → ${cell(f.fix)}` : ''}${f.docs ? ` [docs](${f.docs})` : ''}`);
    }
    for (const f of play.notes) out.push(`- ℹ️ ${cell(f.title)}${f.docs ? ` [docs](${f.docs})` : ''}`);
    out.push('');
  }

  out.push('<details><summary>Data sources</summary>', '', ...dataSources(report).map((s) => `- ${s}`), '', '</details>', '');
  out.push(`<sub>Generated by rn-upgrade-doctor ${report.meta.version} on ${report.meta.scannedAt}</sub>`, '');
  return out.join('\n');
}

/** Make text safe inside a Markdown table cell. */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
