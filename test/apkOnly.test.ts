import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exitCodeFor, renderReport, runScan } from '../src/index.js';
import { ProjectError } from '../src/project/index.js';
import { exampleApks } from '../scripts/example-apks.js';
import { tempDir, writeTree } from './helpers.js';

const ROOT = path.resolve(__dirname, '..');
let dir: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ dir, cleanup } = await tempDir('apk-only'));
  const apks = exampleApks();
  const file = (name: string) => apks.find((a) => a.folder === '09-16kb-apk' && a.file === name)!.data;
  await writeTree(dir, { 'good.apk': file('good.apk'), 'bad.apk': file('bad.apk') });
});

afterEach(() => cleanup());

const options = (apk?: string) => ({ cwd: dir, apk, format: ['json' as const], ci: true, offline: true });

describe('APK-only mode', () => {
  it('scans an APK outside any project', async () => {
    const report = await runScan(options(path.join(dir, 'bad.apk')));
    expect(report.meta).toMatchObject({ mode: 'apk-only', apk: path.join(dir, 'bad.apk') });
    expect(report.findings.map((f) => f.id).sort()).toEqual([
      'apk-16kb:libdemo_native.so',
      'apk-16kb:react-native-mmkv',
      'apk-16kb:react-native-reanimated',
      'play-aab-required',
    ]);
    expect(report.dependencies).toEqual([]);
    expect(report.native.rows).toEqual([]);
    expect(exitCodeFor(report, { ci: true })).toBe(1);

    for (const format of ['terminal', 'md', 'html'] as const) {
      const text = renderReport(report, format);
      expect(text, format).toContain('APK-only scan (no project found)');
      expect(text, format).not.toContain('Native config vs React Native template');
      expect(text, format).not.toContain('React Native version unknown');
    }
  });

  it('exits 0 for a good APK', async () => {
    const report = await runScan(options(path.join(dir, 'good.apk')));
    expect(report.summary.blockers).toBe(0);
    expect(exitCodeFor(report, { ci: true })).toBe(0);
  });

  it('also falls back when package.json exists but has no react-native', async () => {
    await writeTree(dir, { 'package.json': { dependencies: { react: '19.2.0' } } });
    expect((await runScan(options(path.join(dir, 'good.apk')))).meta.mode).toBe('apk-only');
  });

  it('still fails for a broken package.json, and without --apk', async () => {
    await expect(runScan(options())).rejects.toThrow(/No package.json found/);
    await writeTree(dir, { 'package.json': '{ broken' });
    await expect(runScan(options(path.join(dir, 'good.apk')))).rejects.toBeInstanceOf(ProjectError);
  });

  it('keeps the project scan when a project is present', async () => {
    await writeTree(dir, { 'package.json': { dependencies: { 'react-native': '0.87.1' } } });
    const report = await runScan({ ...options(path.join(dir, 'good.apk')), cacheDir: path.join(ROOT, 'examples/registry-snapshot') });
    expect(report.meta.mode).toBe('project');
    expect(report.meta.reactNativeVersion).toBe('0.87.1');
    expect(report.apk?.libs.length).toBeGreaterThan(0);
  });

  it('works from the CLI outside a project', async () => {
    const run = promisify(execFile);
    const cli = path.join(ROOT, 'src/cli.ts');
    const tsx = path.join(ROOT, 'node_modules/tsx/dist/esm/index.mjs');
    const ok = await run(process.execPath, ['--import', tsx, cli, '--apk', 'good.apk', '--ci'], { cwd: dir });
    expect(ok.stdout).toContain('APK-only scan (no project found)');

    const failed = await run(process.execPath, ['--import', tsx, cli, '--apk', 'bad.apk', '--ci'], { cwd: dir }).catch(
      (err: { code: number; stdout: string }) => err,
    );
    expect('code' in failed ? failed.code : 0).toBe(1);
  });

  it('works from the CLI inside a project: full project scan plus the Play Store section', async () => {
    const run = promisify(execFile);
    const tsx = path.join(ROOT, 'node_modules/tsx/dist/esm/index.mjs');
    const args = [
      '--import', tsx, path.join(ROOT, 'src/cli.ts'),
      path.join(ROOT, 'examples/01-healthy-latest'),
      '--apk', path.join(dir, 'good.apk'),
      '--offline', '--cache-dir', path.join(ROOT, 'examples/registry-snapshot'), '--ci',
    ];
    const { stdout } = await run(process.execPath, args, { cwd: dir });
    expect(stdout).toContain('React Native 0.87.1 (latest)');
    expect(stdout).not.toContain('APK-only scan');
    expect(stdout).toContain('Native config vs React Native template');
    expect(stdout).toContain('Play Store ready?  ✅ Ready for Play Store');
  });
});
