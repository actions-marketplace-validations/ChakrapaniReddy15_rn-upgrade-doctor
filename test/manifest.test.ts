import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { attribute, extractManifest, parseAxml, readManifest } from '../src/apk/index.js';
import { makeAxml, makeZip, tempDir, writeTree, type AxmlNodeInput } from './helpers.js';

const manifest: AxmlNodeInput = {
  name: 'manifest',
  attrs: { package: 'com.demo.shop', 'android:versionCode': 42, 'android:versionName': '2.1.0' },
  children: [
    { name: 'uses-sdk', attrs: { 'android:minSdkVersion': 24, 'android:targetSdkVersion': 34 } },
    { name: 'uses-permission', attrs: { 'android:name': 'android.permission.INTERNET' } },
    { name: 'uses-permission', attrs: { 'android:name': 'android.permission.READ_SMS' } },
    { name: 'uses-permission-sdk-23', attrs: { 'android:name': 'android.permission.INTERNET' } },
    {
      name: 'application',
      attrs: { 'android:debuggable': true, 'android:usesCleartextTraffic': true, 'android:networkSecurityConfig': { ref: 0x7f110000 } },
      children: [
        {
          name: 'activity',
          attrs: { 'android:name': '.MainActivity', 'android:exported': true },
          children: [{ name: 'intent-filter', children: [{ name: 'action', attrs: { 'android:name': 'android.intent.action.MAIN' } }] }],
        },
        { name: 'service', attrs: { 'android:name': 'com.demo.shop.SyncService' }, children: [{ name: 'intent-filter' }] },
        { name: 'receiver', attrs: { 'android:name': '.BootReceiver', 'android:exported': false } },
        { name: 'provider', attrs: { 'android:name': 'androidx.startup.InitializationProvider', 'android:exported': false } },
      ],
    },
  ],
};

const expected = {
  package: 'com.demo.shop',
  versionCode: 42,
  versionName: '2.1.0',
  minSdk: 24,
  targetSdk: 34,
  debuggable: true,
  usesCleartextTraffic: true,
  networkSecurityConfig: true,
  permissions: ['android.permission.INTERNET', 'android.permission.READ_SMS'],
  components: [
    { type: 'activity', name: 'com.demo.shop.MainActivity', exported: true, hasIntentFilter: true },
    { type: 'service', name: 'com.demo.shop.SyncService', exported: undefined, hasIntentFilter: true },
    { type: 'receiver', name: 'com.demo.shop.BootReceiver', exported: false, hasIntentFilter: false },
    { type: 'provider', name: 'androidx.startup.InitializationProvider', exported: false, hasIntentFilter: false },
  ],
};

describe('AXML parser', () => {
  it.each([
    ['UTF-16 string pool', {}],
    ['UTF-8 string pool', { utf8: true }],
    ['stripped attribute names (resource IDs only)', { stripNames: true }],
  ])('reads the manifest with a %s', (_label, options) => {
    expect(extractManifest(parseAxml(makeAxml(manifest, options)))).toEqual(expected);
  });

  it('keeps the element tree and typed values', () => {
    const root = parseAxml(makeAxml(manifest));
    expect(root.name).toBe('manifest');
    expect(root.children.map((c) => c.name)).toEqual(['uses-sdk', 'uses-permission', 'uses-permission', 'uses-permission-sdk-23', 'application']);
    const application = root.children[4];
    expect(attribute(application, 'debuggable', 0x0101000f)).toEqual({ type: 'bool', value: true });
    expect(attribute(application, 'networkSecurityConfig', 0x01010527)).toEqual({ type: 'ref', value: 0x7f110000 });
  });

  it('treats missing attributes as not set', () => {
    const m = extractManifest(parseAxml(makeAxml({ name: 'manifest', attrs: { package: 'com.demo.min' } })));
    expect(m).toEqual({ package: 'com.demo.min', networkSecurityConfig: false, permissions: [], components: [] });
  });

  it('rejects input that is not binary XML or not a manifest', () => {
    expect(() => parseAxml(Buffer.from('<manifest/>'))).toThrow(/not a binary XML/);
    expect(() => extractManifest(parseAxml(makeAxml({ name: 'resources' })))).toThrow(/not <manifest>/);
  });
});

describe('readManifest', () => {
  let dir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ dir, cleanup } = await tempDir('manifest'));
  });

  afterEach(() => cleanup());

  it('reads AndroidManifest.xml from an APK', async () => {
    await writeTree(dir, { 'app.apk': makeZip([{ name: 'AndroidManifest.xml', data: makeAxml(manifest) }]) });
    expect(await readManifest(path.join(dir, 'app.apk'), 'apk')).toEqual({ available: true, manifest: expected });
  });

  it('explains why a manifest is not available', async () => {
    await writeTree(dir, {
      'plain.apk': makeZip([{ name: 'AndroidManifest.xml', data: Buffer.from('<manifest/>') }]),
      'none.apk': makeZip([{ name: 'classes.dex', data: Buffer.from('dex') }]),
      'app.aab': makeZip([{ name: 'base/manifest/AndroidManifest.xml', data: Buffer.from([8, 1]) }]),
    });
    expect(await readManifest(path.join(dir, 'plain.apk'), 'apk')).toMatchObject({ available: false, reason: expect.stringMatching(/not a compiled/) });
    expect(await readManifest(path.join(dir, 'none.apk'), 'apk')).toMatchObject({ available: false, reason: expect.stringMatching(/not found/) });
    expect(await readManifest(path.join(dir, 'app.aab'), 'aab')).toMatchObject({ available: false, reason: expect.stringMatching(/need an APK/) });
  });
});
