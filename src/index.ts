import { createRequire } from 'node:module';
import path from 'node:path';
import { readAndroidConfig } from './android/index.js';
import { scanApk } from './apk/index.js';
import { compareNative, playStoreVerdict, registryUnreachable, runChecks } from './checks/index.js';
import { readIosConfig } from './ios/index.js';
import { ProjectError, buildProjectContext, readPackageJson, type PackageJson } from './project/index.js';
import { readPatches } from './project/patches.js';
import { FileCache, getDirectoryInfo, getNpmInfo, getTemplate, type RegistryOptions } from './registry/index.js';
import { upgradeHelperUrl } from './rules/index.js';
import type { DependencyInfo, Finding, NativeTemplates, PatchInfo, ProjectContext, Report, ScanOptions, Sourced } from './types.js';

export * from './types.js';
export { runChecks, rankFindings } from './checks/index.js';
export { renderReport, writeReports } from './report/index.js';

export const TOOL_VERSION = (createRequire(import.meta.url)('../package.json') as { version: string }).version;

/**
 * Process exit code for a report: 1 when there are blockers, else 0. With `ci`, a registry that could not be reached
 * gives 2 (the tool could not do its job), so a network failure never passes as a clean result.
 */
export function exitCodeFor(report: Report, options: { ci: boolean }): 0 | 1 | 2 {
  if (options.ci && registryUnreachable(report.dependencies, [report.native.currentSource, report.native.targetSource])) return 2;
  return report.summary.blockers > 0 ? 1 : 0;
}

export interface RunScanDeps {
  /** Override registry access (tests). */
  registry?: Partial<RegistryOptions>;
}

/**
 * Library entry: read the project, look up every dependency, run every check and return a ranked report.
 * With --apk and no React Native project in the folder, only the APK is scanned (APK-only mode).
 */
export async function runScan(options: ScanOptions, deps: RunScanDeps = {}): Promise<Report> {
  let ctx: ProjectContext;
  try {
    ctx = await buildProjectContext(options.cwd);
  } catch (err) {
    // A folder without a React Native project is fine when there is an APK to check; broken project files are not.
    if (options.apk && err instanceof ProjectError && err.reason !== 'invalid') return runApkOnlyScan(options, options.apk);
    throw err;
  }
  const pkg = await readPackageJson(ctx.cwd);
  const root = ctx.workspaceRoot;
  const rootPrefix = root ? `${path.relative(ctx.cwd, root).split(path.sep).join('/')}/` : '';
  const registry: RegistryOptions = { offline: options.offline, cache: new FileCache(options.cacheDir), ...deps.registry };

  const [dependencies, android, ios, patches, apk] = await Promise.all([
    lookupDependencies(ctx, registry),
    readAndroidConfig(ctx.cwd),
    readIosConfig(ctx.cwd),
    readAllPatches(ctx.cwd, pkg, root, rootPrefix),
    // Like --cwd, a relative --apk path is relative to the folder the command runs in, not to the project.
    options.apk ? scanApk(options.apk, root ? [ctx.cwd, root] : ctx.cwd) : Promise.resolve(undefined),
  ]);

  const rnNpm = dependencies.find((d) => d.name === 'react-native')?.npm;
  const latestReactNative: Sourced<string> = { value: rnNpm?.value?.latest, source: rnNpm?.source ?? 'unknown' };
  // Templates are cached permanently; they give native settings and the tooling versions each release pins.
  const templates = await lookupTemplates(ctx.reactNativeVersion, latestReactNative.value, registry);
  const scannedAt = new Date().toISOString();
  const full: ProjectContext = { ...ctx, latestReactNative, dependencies, android, ios, patches, apk, templates, now: scannedAt };
  const findings = runChecks(full);

  const current = ctx.reactNativeVersion;
  const latest = latestReactNative.value;
  return {
    meta: {
      tool: 'rn-upgrade-doctor',
      version: TOOL_VERSION,
      scannedAt,
      cwd: ctx.cwd,
      apk: apk?.file,
      mode: 'project',
      reactNativeVersion: current,
      reactNativeVersionSource: ctx.reactNativeVersionSource,
      latestReactNative: latest,
      latestReactNativeSource: latestReactNative.source,
      upgradeHelperUrl: current && latest && current !== latest ? upgradeHelperUrl(current, latest) : undefined,
      packageManager: ctx.packageManager,
      lockfile: ctx.lockfile ? path.relative(ctx.cwd, ctx.lockfile).split(path.sep).join('/') : undefined,
      offline: options.offline,
    },
    summary: summarize(findings),
    findings,
    dependencies,
    android,
    ios,
    native: compareNative(full),
    patches,
    apk,
    playStore: apk ? playStoreVerdict(findings, apk) : undefined,
  };
}

/**
 * APK-only mode: no package.json, lockfile, node_modules or android/ folder, so only the built app is checked.
 * Native libraries are matched through the known table only (React Native core, Fresco, popular libraries);
 * anything else is reported by its .so file name.
 */
async function runApkOnlyScan(options: ScanOptions, apkPath: string): Promise<Report> {
  const cwd = path.resolve(options.cwd);
  const apk = await scanApk(apkPath, []);
  const scannedAt = new Date().toISOString();
  const ctx: ProjectContext = { cwd, mode: 'apk-only', installed: {}, declared: {}, devOnly: [], apk, now: scannedAt };
  const findings = runChecks(ctx);
  return {
    meta: {
      tool: 'rn-upgrade-doctor',
      version: TOOL_VERSION,
      scannedAt,
      cwd,
      apk: apk.file,
      mode: 'apk-only',
      offline: options.offline,
    },
    summary: summarize(findings),
    findings,
    dependencies: [],
    native: compareNative(ctx),
    patches: [],
    apk,
    playStore: playStoreVerdict(findings, apk),
  };
}

function summarize(findings: Finding[]): Report['summary'] {
  return {
    blockers: findings.filter((f) => f.severity === 'blocker').length,
    warnings: findings.filter((f) => f.severity === 'warning').length,
    info: findings.filter((f) => f.severity === 'info').length,
  };
}

/** React Native templates for the installed version and the upgrade target (the same version when up to date). */
async function lookupTemplates(
  current: string | undefined,
  target: string | undefined,
  registry: RegistryOptions,
): Promise<NativeTemplates> {
  const none = { source: 'React Native version unknown' };
  const [currentTemplate, targetTemplate] = await Promise.all([
    current ? getTemplate(current, registry) : Promise.resolve(none),
    target && target !== current ? getTemplate(target, registry) : Promise.resolve(undefined),
  ]);
  return {
    currentVersion: current,
    current: currentTemplate,
    targetVersion: target ?? current,
    // Without a known latest version, compare against the installed version's template only.
    target: targetTemplate ?? currentTemplate,
  };
}

/** Patches in the app folder plus, in a monorepo, the workspace root (where patch-package usually runs). */
async function readAllPatches(cwd: string, pkg: PackageJson, root: string | undefined, rootPrefix: string): Promise<PatchInfo[]> {
  const own = await readPatches(cwd, pkg);
  if (!root) return own;
  const rootPkg = await readPackageJson(root).catch(() => ({}));
  return [...own, ...(await readPatches(root, rootPkg, rootPrefix))];
}

/** Specs that do not come from the npm registry: local folders, workspaces, git and tarball URLs. */
const NON_REGISTRY = /^(file:|link:|portal:|workspace:|git(\+\w+)?:|github:|https?:|[\w.-]+\/[\w.-]+(#.*)?$)/;

async function lookupDependencies(ctx: ProjectContext, registry: RegistryOptions): Promise<DependencyInfo[]> {
  const names = Object.keys(ctx.declared).sort();
  const fromRegistry = names.filter((name) => !NON_REGISTRY.test(ctx.declared[name]));
  const [npm, directory] = await Promise.all([getNpmInfo(fromRegistry, registry), getDirectoryInfo(fromRegistry, registry)]);

  return names.map((name) => ({
    name,
    declared: ctx.declared[name],
    installed: ctx.installed[name],
    dev: ctx.devOnly.includes(name),
    npm: npm[name] ?? { source: 'skipped (not from the npm registry)' },
    directory: directory[name] ?? { source: 'skipped (not from the npm registry)' },
  }));
}
