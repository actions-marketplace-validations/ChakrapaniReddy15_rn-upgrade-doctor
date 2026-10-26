import { describe, expect, it } from 'vitest';
import { checkPlayStore } from '../src/checks/index.js';
import type { ApkManifest, ApkReport, ApkSigning, ManifestComponent, NativeLib, ProjectContext, SigningCertificate } from '../src/types.js';

const NOW = '2026-10-26T00:00:00.000Z';

const manifest = (overrides: Partial<ApkManifest> = {}): ApkManifest => ({
  package: 'com.demo.shop',
  minSdk: 24,
  targetSdk: 36,
  networkSecurityConfig: false,
  permissions: ['android.permission.INTERNET'],
  components: [{ type: 'activity', name: 'com.demo.shop.MainActivity', exported: true, hasIntentFilter: true }],
  ...overrides,
});

const cert = (overrides: Partial<SigningCertificate> = {}): SigningCertificate => ({
  subject: 'CN=Demo Release, O=Demo, C=US',
  sha256: 'AA:BB',
  validFrom: '2026-01-01T00:00:00.000Z',
  validTo: '2060-01-01T00:00:00.000Z',
  debug: false,
  schemes: ['v2'],
  ...overrides,
});

const signing = (overrides: Partial<ApkSigning> = {}): ApkSigning => ({
  schemes: ['v2', 'v3'],
  debugSigned: false,
  unsigned: false,
  certificates: [cert()],
  ...overrides,
});

const lib64: NativeLib = { path: 'lib/arm64-v8a/libreactnative.so', abi: 'arm64-v8a', name: 'libreactnative.so', is64Bit: true, loadAlign: 16384, elfOk: true, stored: true, zipAligned: true };
const lib32: NativeLib = { ...lib64, path: 'lib/armeabi-v7a/libreactnative.so', abi: 'armeabi-v7a', is64Bit: false };

function apk(overrides: Partial<ApkReport> & { manifestData?: ApkManifest } = {}): ApkReport {
  const { manifestData, ...rest } = overrides;
  return {
    file: '/x/app-release.apk',
    kind: 'apk',
    libs: [lib64],
    manifest: { available: true, manifest: manifestData ?? manifest() },
    signing: signing(),
    ...rest,
  };
}

const run = (report: ApkReport) => checkPlayStore({ cwd: '/x', installed: {}, declared: {}, devOnly: [], apk: report, now: NOW } as ProjectContext);
const ids = (report: ApkReport) => run(report).map((f) => `${f.severity}:${f.id}`);

describe('checkPlayStore', () => {
  it('passes a release-ready APK with only the AAB note', () => {
    expect(ids(apk())).toEqual(['info:play-aab-required']);
  });

  it('does nothing without an APK', () => {
    expect(checkPlayStore({ cwd: '/x', installed: {}, declared: {}, devOnly: [] })).toEqual([]);
  });

  it('blocks a targetSdk below the Play minimum', () => {
    const findings = run(apk({ manifestData: manifest({ targetSdk: 34 }) }));
    expect(findings[0]).toMatchObject({ id: 'play-target-sdk', severity: 'blocker', docs: expect.stringContaining('target-sdk') });
    expect(findings[0].title).toContain('targetSdkVersion 34 is below 36');
  });

  it('blocks native code without a 64-bit ABI, but not apps without native code', () => {
    expect(ids(apk({ libs: [lib32] }))).toContain('blocker:play-64bit');
    expect(ids(apk({ libs: [lib32, lib64] }))).not.toContain('blocker:play-64bit');
    expect(ids(apk({ libs: [] }))).not.toContain('blocker:play-64bit');
  });

  it('blocks a debuggable app', () => {
    expect(ids(apk({ manifestData: manifest({ debuggable: true }) }))).toContain('blocker:play-debuggable');
    expect(ids(apk({ manifestData: manifest({ debuggable: false }) }))).not.toContain('blocker:play-debuggable');
  });

  it('blocks unsigned and debug-signed apps', () => {
    expect(ids(apk({ signing: signing({ schemes: [], unsigned: true, certificates: [] }) }))).toEqual(['blocker:play-unsigned', 'info:play-aab-required']);
    expect(ids(apk({ signing: signing({ debugSigned: true, certificates: [cert({ subject: 'CN=Android Debug', debug: true, validTo: '2030-01-01T00:00:00.000Z' })] }) }))).toEqual([
      'blocker:play-debug-signed',
      'info:play-aab-required',
    ]);
  });

  it('blocks v1-only signing for targetSdk 30+ APKs, not for older targets or AABs', () => {
    expect(ids(apk({ signing: signing({ schemes: ['v1'] }) }))).toContain('blocker:play-v1-only');
    expect(ids(apk({ signing: signing({ schemes: ['v1'] }), manifestData: manifest({ targetSdk: 29 }) }))).not.toContain('blocker:play-v1-only');
    expect(ids(apk({ kind: 'aab', signing: signing({ schemes: ['v1'] }), manifest: { available: false, reason: 'AAB' } }))).not.toContain('blocker:play-v1-only');
  });

  it('blocks an expired certificate and one that ends before 22 Oct 2033', () => {
    expect(ids(apk({ signing: signing({ certificates: [cert({ validTo: '2000-12-31T00:00:00.000Z' })] }) }))).toContain('blocker:play-cert-expired');
    const short = run(apk({ signing: signing({ certificates: [cert({ validTo: '2029-12-31T00:00:00.000Z' })] }) }));
    expect(short.map((f) => f.id)).toContain('play-cert-validity');
    expect(short.find((f) => f.id === 'play-cert-validity')?.title).toContain('2029-12-31');
    expect(ids(apk({ signing: signing({ certificates: [cert({ validTo: '2033-10-23T00:00:00.000Z' })] }) }))).toEqual(['info:play-aab-required']);
  });

  it('blocks components with an intent filter but no android:exported, from targetSdk 31', () => {
    const components: ManifestComponent[] = [
      { type: 'activity', name: 'com.demo.shop.MainActivity', exported: true, hasIntentFilter: true },
      { type: 'service', name: 'com.demo.shop.SyncService', hasIntentFilter: true },
      { type: 'receiver', name: 'com.demo.shop.BootReceiver', hasIntentFilter: true },
      { type: 'activity', name: 'com.demo.shop.Settings', hasIntentFilter: false },
      { type: 'provider', name: 'com.demo.shop.Files', hasIntentFilter: true },
    ];
    const findings = run(apk({ manifestData: manifest({ components }) }));
    const exported = findings.find((f) => f.id === 'play-exported');
    expect(exported).toMatchObject({ severity: 'blocker', title: '2 components have an intent filter but no android:exported' });
    expect(exported?.detail).toContain('service com.demo.shop.SyncService, receiver com.demo.shop.BootReceiver');
    expect(ids(apk({ manifestData: manifest({ components, targetSdk: 30 }) }))).not.toContain('blocker:play-exported');
  });

  it('warns about each sensitive permission with its policy link', () => {
    const findings = run(
      apk({ manifestData: manifest({ permissions: ['android.permission.INTERNET', 'android.permission.READ_SMS', 'android.permission.QUERY_ALL_PACKAGES'] }) }),
    );
    expect(findings.filter((f) => f.id.startsWith('play-permission:')).map((f) => [f.severity, f.id, f.docs])).toEqual([
      ['warning', 'play-permission:READ_SMS', 'https://support.google.com/googleplay/android-developer/answer/10208820'],
      ['warning', 'play-permission:QUERY_ALL_PACKAGES', 'https://support.google.com/googleplay/android-developer/answer/10158779'],
    ]);
  });

  it('warns when cleartext traffic is allowed', () => {
    expect(ids(apk({ manifestData: manifest({ usesCleartextTraffic: true }) }))).toContain('warning:play-cleartext');
    expect(ids(apk({ manifestData: manifest({ usesCleartextTraffic: false }) }))).not.toContain('warning:play-cleartext');
  });

  it('says when manifest checks could not run, and has no AAB note for an AAB', () => {
    expect(ids(apk({ kind: 'aab', manifest: { available: false, reason: 'Manifest checks need an APK.' } }))).toEqual(['info:play-manifest-unavailable']);
  });

  it('gives every finding a fix and every rule a docs link', () => {
    const everything = run(
      apk({
        libs: [lib32],
        manifestData: manifest({ targetSdk: 34, debuggable: true, usesCleartextTraffic: true, permissions: ['android.permission.SEND_SMS'] }),
        signing: signing({ debugSigned: true, certificates: [cert({ validTo: '2029-01-01T00:00:00.000Z' })] }),
      }),
    );
    for (const f of everything) {
      expect(f.fix, f.id).toBeTruthy();
      expect(f.docs, f.id).toMatch(/^https:\/\//);
    }
  });
});
