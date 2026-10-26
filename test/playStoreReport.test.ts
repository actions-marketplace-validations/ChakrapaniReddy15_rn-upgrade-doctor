import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { playStoreVerdict } from '../src/checks/index.js';
import { exitCodeFor, renderReport, runScan } from '../src/index.js';
import { playStoreSection } from '../src/report/playStoreSection.js';
import type { ApkReport, Finding, PlayStoreVerdict, Report } from '../src/types.js';
import { DEBUG_CERT, RELEASE_CERT, der } from './certs.js';
import { makeAxml, makeElf, makeZip, signerBlockValue, tempDir, writeTree } from './helpers.js';

const finding = (id: string, severity: Finding['severity']): Finding => ({ id, severity, title: id, fix: `fix ${id}`, source: 'test', docs: `https://example.test/${id}` });

const apkReport: ApkReport = {
  file: '/x/app.apk',
  kind: 'apk',
  libs: [],
  manifest: {
    available: true,
    manifest: { package: 'com.demo.shop', versionName: '2.1.0', versionCode: 42, minSdk: 24, targetSdk: 36, networkSecurityConfig: false, permissions: [], components: [] },
  },
  signing: {
    schemes: ['v2', 'v3'],
    debugSigned: false,
    unsigned: false,
    certificates: [{ subject: 'CN=Demo Release', sha256: 'AA:BB', validFrom: '2026-01-01T00:00:00.000Z', validTo: '2060-01-01T00:00:00.000Z', debug: false, schemes: ['v2', 'v3'] }],
  },
};

describe('playStoreVerdict', () => {
  it('counts Play blockers and warnings, including the 16 KB blockers', () => {
    const findings = [
      finding('apk-16kb:react-native-mmkv', 'blocker'),
      finding('play-debug-signed', 'blocker'),
      finding('dep-outdated:react', 'warning'),
      finding('play-cleartext', 'warning'),
      finding('apk-16kb-ok', 'info'),
      finding('play-aab-required', 'info'),
    ];
    expect(playStoreVerdict(findings, apkReport)).toEqual({
      ready: false,
      blockers: 2,
      warnings: 1,
      findingIds: ['apk-16kb:react-native-mmkv', 'play-debug-signed', 'play-cleartext', 'play-aab-required'],
      app: { package: 'com.demo.shop', versionName: '2.1.0', versionCode: 42, minSdk: 24, targetSdk: 36 },
      signing: { schemes: ['v2', 'v3'], certificates: [{ subject: 'CN=Demo Release', sha256: 'AA:BB', validTo: '2060-01-01T00:00:00.000Z' }] },
    });
  });

  it('is ready without Play blockers and leaves out what it does not know', () => {
    const verdict = playStoreVerdict([finding('play-aab-required', 'info')], { ...apkReport, manifest: { available: false, reason: 'AAB' }, signing: { schemes: [], debugSigned: false, unsigned: true, certificates: [] } });
    expect(verdict).toEqual({ ready: true, blockers: 0, warnings: 0, findingIds: ['play-aab-required'] });
  });
});

describe('playStoreSection headings', () => {
  const section = (verdict: Partial<PlayStoreVerdict>) =>
    playStoreSection({ findings: [], playStore: { ready: true, blockers: 0, warnings: 0, findingIds: [], ...verdict } } as unknown as Report)!.heading;

  it.each([
    [{}, '✅ Ready for Play Store'],
    [{ warnings: 1 }, '✅ Ready for Play Store (⚠️ 1 warning to review)'],
    [{ ready: false, blockers: 1 }, '❌ 1 blocker'],
    [{ ready: false, blockers: 3, warnings: 2 }, '❌ 3 blockers, ⚠️ 2 warnings'],
  ])('%o -> %s', (verdict, heading) => {
    expect(section(verdict)).toBe(heading);
  });

  it('is absent without an APK scan', () => {
    expect(playStoreSection({ findings: [] } as unknown as Report)).toBeUndefined();
  });
});

describe('Play Store section in reports', () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await tempDir('play-report'));
  });

  afterEach(() => cleanup());

  const manifest = (targetSdk: number) =>
    makeAxml({
      name: 'manifest',
      attrs: { package: 'com.demo.shop', 'android:versionCode': 3, 'android:versionName': '1.2' },
      children: [{ name: 'uses-sdk', attrs: { 'android:minSdkVersion': 24, 'android:targetSdkVersion': targetSdk } }, { name: 'application' }],
    });
  const apk = (targetSdk: number, cert: string) =>
    makeZip(
      [{ name: 'AndroidManifest.xml', data: manifest(targetSdk) }, { name: 'lib/arm64-v8a/libreactnative.so', data: makeElf({ is64Bit: true, loadAligns: [16384] }) }],
      { signingBlock: [{ id: 0x7109871a, value: signerBlockValue([der(cert)]) }] },
    );
  const scan = (file: string) => runScan({ cwd: dir, apk: path.join(dir, file), format: ['json'], ci: true, offline: true });

  it('shows the blockers with fixes and docs, and exits 1', async () => {
    await writeTree(dir, { 'app.apk': apk(34, DEBUG_CERT) });
    const report = await scan('app.apk');
    expect(report.playStore).toMatchObject({ ready: false, blockers: 2, app: { package: 'com.demo.shop', targetSdk: 34 } });
    expect(exitCodeFor(report, { ci: true })).toBe(1);

    for (const format of ['terminal', 'md', 'html'] as const) {
      const text = renderReport(report, format);
      expect(text, format).toContain('Play Store ready?');
      expect(text, format).toContain('❌ 2 blockers');
      expect(text, format).toContain('Signed with the Android debug key');
      expect(text, format).toContain('https://developer.android.com/google/play/requirements/target-sdk');
      expect(text, format).toContain(report.playStore!.signing!.certificates[0].sha256);
    }
    expect(JSON.parse(renderReport(report, 'json')).playStore.findingIds).toEqual(['play-target-sdk', 'play-debug-signed', 'play-aab-required']);
  });

  it('says ready for a release-signed APK and exits 0', async () => {
    await writeTree(dir, { 'app.apk': apk(36, RELEASE_CERT) });
    const report = await scan('app.apk');
    expect(report.playStore?.ready).toBe(true);
    expect(exitCodeFor(report, { ci: true })).toBe(0);
    for (const format of ['terminal', 'md', 'html'] as const) expect(renderReport(report, format), format).toContain('✅ Ready for Play Store');
  });

  it('shows docs links in "What to fix first" too', async () => {
    await writeTree(dir, { 'app.apk': apk(34, RELEASE_CERT) });
    const terminal = renderReport(await scan('app.apk'), 'terminal');
    const whatToFix = terminal.slice(terminal.indexOf('What to fix first'), terminal.indexOf('Play Store ready?'));
    expect(whatToFix).toContain('docs: https://developer.android.com/google/play/requirements/target-sdk');
  });
});
