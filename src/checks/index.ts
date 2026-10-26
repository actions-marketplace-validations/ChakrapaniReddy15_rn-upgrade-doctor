import type { Finding, ProjectContext, Severity } from '../types.js';
import { checkApk } from './apk.js';
import { checkDataGaps } from './data.js';
import { checkDependencies } from './dependencies.js';
import { checkNativeTemplate } from './native.js';
import { checkPlayStore } from './playStore.js';
import { checkPatches } from './patches.js';
import { checkAndroid, checkIos } from './platforms.js';
import { checkReactNative } from './reactNative.js';

export { checkApk, checkAndroid, checkDataGaps, checkDependencies, checkIos, checkPatches, checkReactNative };
export { registryUnreachable } from './data.js';
export { checkNativeTemplate, compareNative } from './native.js';
export { checkPlayStore, isPlayFinding, playStoreVerdict, PLAY_ID_PREFIX } from './playStore.js';

/**
 * Order inside a severity: what blocks a release first, then gaps in the data (so a quiet report is not read as a
 * clean one), then the upgrade itself, then housekeeping.
 */
const CHECKS: Array<(ctx: ProjectContext) => Finding[]> = [
  checkApk,
  checkPlayStore,
  checkDataGaps,
  checkReactNative,
  checkDependencies,
  checkAndroid,
  checkNativeTemplate,
  checkIos,
  checkPatches,
];

/** Without a project there is no package.json, lockfile or android/ folder: only the built app can be checked. */
const APK_ONLY_CHECKS: Array<(ctx: ProjectContext) => Finding[]> = [checkApk, checkPlayStore];

const SEVERITY_RANK: Record<Severity, number> = { blocker: 0, warning: 1, info: 2 };

/**
 * Run every check and rank the findings: by severity; within a severity, findings about dev-only packages (tooling that
 * is not shipped in the app) come last; otherwise check order is kept (the sort is stable).
 */
export function runChecks(ctx: ProjectContext): Finding[] {
  const devOnly = new Set(ctx.devOnly);
  const checks = ctx.mode === 'apk-only' ? APK_ONLY_CHECKS : CHECKS;
  return rankFindings(checks.flatMap((check) => check(ctx)), (f) => (f.package !== undefined && devOnly.has(f.package) ? 1 : 0));
}

export function rankFindings(findings: Finding[], tieBreak: (finding: Finding) => number = () => 0): Finding[] {
  return [...findings].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || tieBreak(a) - tieBreak(b));
}
