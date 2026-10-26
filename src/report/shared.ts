import type { DependencyInfo, Finding, NativeRow, NativeStatus, Report, Severity } from '../types.js';

export const SEVERITY_LABEL: Record<Severity, string> = { blocker: 'Blocker', warning: 'Warning', info: 'Info' };

export function newArchLabel(dep: DependencyInfo): string {
  const status = dep.directory.value?.newArchitecture;
  if (status === 'new-arch-only') return 'yes (only)';
  if (status === 'supported') return 'yes';
  if (status === 'unsupported') return 'no';
  if (status === 'untested') return 'untested';
  return '–';
}

export function maintenanceLabel(dep: DependencyInfo): string {
  if (dep.npm.value?.deprecated) return 'deprecated';
  if (dep.directory.value?.unmaintained) return 'unmaintained';
  if (dep.directory.value) return 'ok';
  return '–';
}

/** Dependencies worth listing: React Native itself, libraries in React Native Directory and anything with a finding. */
export function interestingDependencies(report: Report): DependencyInfo[] {
  const flagged = new Set(report.findings.map((f) => f.package).filter(Boolean));
  return report.dependencies.filter((d) => d.directory.value || flagged.has(d.name) || d.name === 'react-native');
}

export const APK_ONLY_HEADLINE = 'APK-only scan (no project found)';

export function headline(report: Report): string {
  if (report.meta.mode === 'apk-only') return APK_ONLY_HEADLINE;
  const { reactNativeVersion, latestReactNative } = report.meta;
  if (!reactNativeVersion) return 'React Native version unknown';
  if (!latestReactNative) return `React Native ${reactNativeVersion} (latest unknown${report.meta.offline ? ', offline' : ''})`;
  if (reactNativeVersion === latestReactNative) return `React Native ${reactNativeVersion} (latest)`;
  return `React Native ${reactNativeVersion} → ${latestReactNative}`;
}

export function dataSources(report: Report): string[] {
  if (report.meta.mode === 'apk-only') {
    return [`APK: ${report.meta.apk}`, `Project: none found in ${report.meta.cwd}, so dependency, Android, iOS and patch checks did not run`];
  }
  const sources = new Set<string>();
  const lockfile = report.meta.lockfile ? ` (${report.meta.lockfile})` : '';
  sources.add(`React Native version: ${report.meta.reactNativeVersionSource}${report.meta.reactNativeVersionSource === 'lockfile' ? lockfile : ''}`);
  if (report.meta.latestReactNativeSource) sources.add(`Latest React Native: ${report.meta.latestReactNativeSource}`);
  const npm = countBy(report.dependencies.map((d) => d.npm.source));
  const dir = countBy(report.dependencies.map((d) => d.directory.source));
  sources.add(`Versions: ${npm}`);
  sources.add(`New Architecture / maintenance: ${dir}`);
  if (report.native.rows.length > 0) sources.add(nativeSourceLine(report));
  return [...sources];
}

function countBy(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].map(([value, n]) => `${value} (${n})`).join(', ') || 'none';
}

export const NATIVE_STATUS_LABEL: Record<NativeStatus, string> = {
  ok: '✓',
  newer: '✓ newer',
  raised: '▲ raised by the upgrade',
  behind: '▲ behind your RN version',
  'below-required': '✖ below the minimum',
  differs: '▲ differs from the template',
  unknown: '–',
};

export interface NativeSection {
  platform: 'Android' | 'iOS';
  /** Files your values came from; empty when the platform folder was not found. */
  files: string[];
  rows: NativeRow[];
}

/** Template column headers: one per distinct React Native version (current, and target when it differs). */
export function templateColumns(report: Report): Array<{ key: 'current' | 'target'; title: string }> {
  const { currentVersion, targetVersion } = report.native;
  if (!targetVersion || targetVersion === currentVersion) return [{ key: 'target', title: `RN ${targetVersion ?? '?'} template` }];
  return [
    { key: 'current', title: `RN ${currentVersion ?? '?'} (yours)` },
    { key: 'target', title: `RN ${targetVersion} (target)` },
  ];
}

/** Your Android and iOS settings next to the React Native template values, grouped by platform. */
export function nativeSections(report: Report): NativeSection[] {
  return (['Android', 'iOS'] as const).map((platform) => ({
    platform,
    files: (platform === 'Android' ? report.android?.files : report.ios?.files) ?? [],
    rows: report.native.rows.filter((r) => r.platform === platform),
  }));
}

export function nativeSourceLine(report: Report): string {
  const { currentVersion, currentSource, targetVersion, targetSource } = report.native;
  if (!targetVersion || targetVersion === currentVersion) return `React Native template: ${targetSource}`;
  return `React Native templates: ${currentVersion ?? '?'} ${currentSource}; ${targetVersion} ${targetSource}`;
}

export interface FindingGroup {
  /** Highest severity in the group (findings are already ranked, so it is the first one's). */
  severity: Severity;
  package?: string;
  findings: Finding[];
}

/**
 * One entry per package for display: findings about the same package are listed together at the position of its
 * most severe finding. Findings without a package stay on their own. The JSON report keeps every finding separately.
 */
export function groupFindings(findings: Finding[]): FindingGroup[] {
  const groups: FindingGroup[] = [];
  const byPackage = new Map<string, FindingGroup>();
  for (const finding of findings) {
    const existing = finding.package ? byPackage.get(finding.package) : undefined;
    if (existing) {
      existing.findings.push(finding);
      continue;
    }
    const group: FindingGroup = { severity: finding.severity, package: finding.package, findings: [finding] };
    groups.push(group);
    if (finding.package) byPackage.set(finding.package, group);
  }
  return groups;
}

/**
 * Shown when an Android app was scanned without --apk: the 16 KB check needs the built app, and a report that is
 * silent about it would read as "checked and fine".
 */
export const SIXTEEN_KB_NOT_CHECKED =
  "Not checked: pass --apk with a release APK or AAB to scan your app's native libraries.";

export function sixteenKbNotChecked(report: Report): boolean {
  return !report.apk && report.android !== undefined;
}

/** The second header line: the project folder (and package manager), or the APK in APK-only mode. */
export function subtitle(report: Report): string {
  if (report.meta.mode === 'apk-only') return report.meta.apk ?? '';
  return `${report.meta.cwd}${report.meta.packageManager ? ` · ${report.meta.packageManager}` : ''}`;
}
