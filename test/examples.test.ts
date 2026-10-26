import { execFile } from 'node:child_process';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exampleApks } from '../scripts/example-apks.js';
import { EXAMPLES, exampleArgs, type ExampleRun } from '../scripts/examples.js';
import { mapLimit } from '../src/registry/index.js';
import type { Report } from '../src/types.js';
import { tempDir } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = promisify(execFile);

let tmp: string;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  ({ dir: tmp, cleanup } = await tempDir('examples'));
  for (const apk of exampleApks()) await writeFile(path.join(tmp, apk.file), apk.data);
});

afterAll(() => cleanup());

/** Run the real CLI (offline, registry snapshot) and return its exit code and JSON report. */
async function scan(example: ExampleRun): Promise<{ code: number; stderr: string; report?: Report }> {
  const out = path.join(tmp, example.name.replace(/\W+/g, '-'));
  // Use the generated APKs from the temp folder instead of the example folders (where they may not exist yet).
  const args = exampleArgs(example).map((a) => (example.apk && a.endsWith(example.apk) ? path.join(tmp, example.apk) : a));
  let code = 0;
  let stderr = '';
  try {
    await run(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args, '--format', 'json', '--out', out], { cwd: ROOT });
  } catch (err) {
    const e = err as { code?: number; stderr?: string };
    code = e.code ?? -1;
    stderr = e.stderr ?? '';
  }
  const report = await readFile(path.join(out, 'rn-upgrade-doctor-report.json'), 'utf8').then(
    (text) => JSON.parse(text) as Report,
    () => undefined,
  );
  return { code, stderr, report };
}

/** Stable form for snapshots: no timestamps, machine paths or tool version; findings sorted by id. */
function normalize(report: Report): unknown {
  const text = JSON.stringify({ ...report, findings: [...report.findings].sort((a, b) => a.id.localeCompare(b.id)) })
    .split(JSON.stringify(ROOT).slice(1, -1))
    .join('<repo>')
    .split(JSON.stringify(tmp).slice(1, -1))
    .join('<tmp>');
  const parsed = JSON.parse(text) as Report;
  return { ...parsed, meta: { ...parsed.meta, scannedAt: '<time>', version: '<version>' } };
}

const ids = (report?: Report) => (report?.findings ?? []).map((f) => `${f.severity}:${f.id}`).sort();

describe('examples', () => {
  const results = new Map<string, Awaited<ReturnType<typeof scan>>>();

  beforeAll(async () => {
    // Each run starts a CLI process that compiles TypeScript; a few at a time keeps small CI machines responsive.
    await mapLimit(EXAMPLES, 4, async (example) => results.set(example.name, await scan(example)));
  }, 120_000);

  it.each(EXAMPLES.map((e) => [e.name, e] as const))('%s', (_name, example) => {
    const result = results.get(example.name)!;
    expect(result.code, result.stderr).toBe(example.exitCode);
    if (example.exitCode === 2) {
      expect(result.report).toBeUndefined();
      expect(result.stderr).toContain('does not look like a React Native app');
      return;
    }
    expect(ids(result.report)).toEqual(example.findings);
    expect(normalize(result.report!)).toMatchSnapshot();
  });

  it('02 links to the upgrade helper', () => {
    expect(results.get('02 old RN version')!.report!.meta.upgradeHelperUrl).toBe(
      'https://react-native-community.github.io/upgrade-helper/?from=0.68.7&to=0.87.1',
    );
  });

  it('08 gives the same findings for npm, yarn and pnpm', () => {
    const [npm, yarn, pnpm] = ['npm', 'yarn', 'pnpm'].map((pm) => results.get(`08 lockfiles (${pm})`)!.report!);
    expect([npm, yarn, pnpm].map((r) => r.meta.packageManager)).toEqual(['npm', 'yarn', 'pnpm']);
    expect(yarn.findings).toEqual(npm.findings);
    expect(pnpm.findings).toEqual(npm.findings);
    expect(yarn.dependencies.map((d) => d.installed)).toEqual(npm.dependencies.map((d) => d.installed));
    expect(pnpm.dependencies.map((d) => d.installed)).toEqual(npm.dependencies.map((d) => d.installed));
  });

  it('covers every finding id the checks can emit', async () => {
    // Collect ids from the source: id: 'fixed-id' and id: `prefix:${...}`.
    const dir = path.join(ROOT, 'src', 'checks');
    const source = (await Promise.all((await readdir(dir)).map((f) => readFile(path.join(dir, f), 'utf8')))).join('\n');
    const known = [...source.matchAll(/id: ['`]([\w-]+)(:?)/g)].map((m) => m[1] + m[2]);
    const seen = EXAMPLES.flatMap((e) => e.findings).map((f) => f.slice(f.indexOf(':') + 1));

    const uncovered = [...new Set(known)].filter((id) => !seen.some((s) => (id.endsWith(':') ? s.startsWith(id) : s === id)));
    expect(known.length).toBeGreaterThan(15);
    expect(uncovered).toEqual([]);
  });
});
