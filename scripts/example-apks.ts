/**
 * Synthetic APKs and AABs for the examples, built with the same helpers the unit tests use, so no binaries are
 * committed (*.apk and *.aab are git-ignored). The .so files are minimal ELF headers (no code); manifests are compiled
 * binary XML; signatures carry throwaway test certificates (test/certs.ts) in the real signing-block layout.
 *
 * examples/09-16kb-apk:  good.apk / bad.apk differ only in their 16 KB results.
 * examples/15-play-store: one APK per Google Play rule, scanned without a project (APK-only mode).
 */
import { DEBUG_CERT, EXPIRED_CERT, RELEASE_CERT, SHORT_CERT, der } from '../test/certs.js';
import { makeAxml, makeElf, makeZip, pkcs7, signerBlockValue, type AxmlNodeInput, type ZipInput, type ZipOptions } from '../test/helpers.js';

export interface ExampleApk {
  /** Folder under examples/. */
  folder: string;
  /** File name; unique across all examples. */
  file: string;
  data: Buffer;
}

const K4 = 4096;
const K16 = 16384;
const V2 = 0x7109871a;
const V3 = 0xf05368c0;

const elf64 = (align: number) => makeElf({ is64Bit: true, loadAligns: [align, align] });
const elf32 = () => makeElf({ is64Bit: false, loadAligns: [K4] });

interface ManifestOptions {
  pkg?: string;
  targetSdk?: number;
  debuggable?: boolean;
  cleartext?: boolean;
  permissions?: string[];
  /** Extra components; the launcher activity (exported) is always there. */
  components?: AxmlNodeInput[];
}

/** A compiled manifest; the defaults are release-ready (target API 36, launcher activity with android:exported). */
function manifest(options: ManifestOptions = {}): ZipInput {
  const application: Record<string, boolean> = {};
  if (options.debuggable !== undefined) application['android:debuggable'] = options.debuggable;
  if (options.cleartext !== undefined) application['android:usesCleartextTraffic'] = options.cleartext;
  return {
    name: 'AndroidManifest.xml',
    data: makeAxml({
      name: 'manifest',
      attrs: { package: options.pkg ?? 'com.demo.scanner', 'android:versionCode': 1, 'android:versionName': '1.0' },
      children: [
        { name: 'uses-sdk', attrs: { 'android:minSdkVersion': 24, 'android:targetSdkVersion': options.targetSdk ?? 36 } },
        ...['android.permission.INTERNET', ...(options.permissions ?? [])].map((name) => ({ name: 'uses-permission', attrs: { 'android:name': name } })),
        {
          name: 'application',
          attrs: application,
          children: [
            {
              name: 'activity',
              attrs: { 'android:name': '.MainActivity', 'android:exported': true },
              children: [
                {
                  name: 'intent-filter',
                  children: [
                    { name: 'action', attrs: { 'android:name': 'android.intent.action.MAIN' } },
                    { name: 'category', attrs: { 'android:name': 'android.intent.category.LAUNCHER' } },
                  ],
                },
              ],
            },
            ...(options.components ?? []),
          ],
        },
      ],
    }),
  };
}

/** v2 + v3 signatures with one certificate. */
const signedWith = (cert: string): ZipOptions => ({
  signingBlock: [
    { id: V2, value: signerBlockValue([der(cert)]) },
    { id: V3, value: signerBlockValue([der(cert)]) },
  ],
});
const releaseSigned = signedWith(RELEASE_CERT);

/** 16 KB-ready 64-bit libraries, stored and aligned like the Android Gradle Plugin does. */
const readyLibs: ZipInput[] = [
  { name: 'lib/arm64-v8a/libreactnative.so', data: elf64(K16), stored: true, alignTo: K16 },
  { name: 'lib/x86_64/libreactnative.so', data: elf64(K16), stored: true, alignTo: K16 },
];

const playStore = (file: string, entries: ZipInput[], options: ZipOptions = releaseSigned): ExampleApk => ({
  folder: '15-play-store',
  file,
  data: makeZip(entries, options),
});

export function exampleApks(): ExampleApk[] {
  return [
    // --- examples/09-16kb-apk: only the 16 KB results differ.
    {
      folder: '09-16kb-apk',
      file: 'good.apk',
      // Every 64-bit library has 16 KB ELF segments; stored libraries start on a 16 KB boundary in the zip.
      data: makeZip(
        [
          manifest(),
          { name: 'lib/arm64-v8a/libreactnative.so', data: elf64(K16), stored: true, alignTo: K16 },
          { name: 'lib/arm64-v8a/libreanimated.so', data: elf64(K16), stored: true, alignTo: K16 },
          { name: 'lib/arm64-v8a/libreactnativemmkv.so', data: elf64(K16), stored: true, alignTo: K16 },
          { name: 'lib/x86_64/libreactnative.so', data: elf64(K16), stored: true, alignTo: K16 },
          // 32-bit libraries are not affected by 16 KB pages and are not checked.
          { name: 'lib/armeabi-v7a/libreactnative.so', data: elf32() },
        ],
        releaseSigned,
      ),
    },
    {
      folder: '09-16kb-apk',
      file: 'bad.apk',
      data: makeZip(
        [
          manifest(),
          // Passes: 16 KB ELF, compressed (extracted at install, so zip alignment does not matter).
          { name: 'lib/arm64-v8a/libc++_shared.so', data: elf64(K16) },
          // Fails ELF check: 4 KB segments. Mapped to react-native-reanimated through the known table.
          { name: 'lib/arm64-v8a/libreanimated.so', data: elf64(K4) },
          // Fails zip check: 16 KB ELF but stored uncompressed 4 KB past a 16 KB boundary. Mapped to react-native-mmkv.
          { name: 'lib/arm64-v8a/libreactnativemmkv.so', data: elf64(K16), stored: true, alignTo: K16, misalignBy: K4 },
          // Fails ELF check and no package owns it: reported by file name.
          { name: 'lib/arm64-v8a/libdemo_native.so', data: elf64(K4), stored: true, alignTo: K16 },
        ],
        releaseSigned,
      ),
    },

    // --- examples/15-play-store: one problem per APK (APK-only mode, no project in the folder).
    playStore('ready.apk', [manifest(), ...readyLibs]),
    playStore('target-sdk-34.apk', [manifest({ targetSdk: 34 }), ...readyLibs]),
    playStore('debuggable.apk', [manifest({ debuggable: true }), ...readyLibs]),
    playStore('debug-signed.apk', [manifest(), ...readyLibs], signedWith(DEBUG_CERT)),
    playStore('missing-exported.apk', [
      manifest({
        components: [
          { name: 'service', attrs: { 'android:name': '.SyncService' }, children: [{ name: 'intent-filter' }] },
          { name: 'receiver', attrs: { 'android:name': '.BootReceiver' }, children: [{ name: 'intent-filter' }] },
        ],
      }),
      ...readyLibs,
    ]),
    playStore('32bit-only.apk', [manifest(), { name: 'lib/armeabi-v7a/libreactnative.so', data: elf32() }]),
    playStore('sms-permission.apk', [manifest({ permissions: ['android.permission.READ_SMS'] }), ...readyLibs]),
    playStore('cleartext.apk', [manifest({ cleartext: true }), ...readyLibs]),
    playStore('unsigned.apk', [manifest(), ...readyLibs], {}),
    // v1 only: a JAR signature file with the release certificate and no APK Signing Block.
    playStore('v1-only.apk', [manifest(), ...readyLibs, { name: 'META-INF/DEMO.RSA', data: pkcs7([der(RELEASE_CERT)]) }], {}),
    playStore('cert-expired.apk', [manifest(), ...readyLibs], signedWith(EXPIRED_CERT)),
    playStore('cert-before-2033.apk', [manifest(), ...readyLibs], signedWith(SHORT_CERT)),
    // An AAB: protobuf manifest (manifest checks need an APK), libraries under base/, signed with v1 like bundletool does.
    playStore(
      'app-release.aab',
      [
        { name: 'base/manifest/AndroidManifest.xml', data: Buffer.from([0x0a, 0x00]) },
        { name: 'base/lib/arm64-v8a/libreactnative.so', data: elf64(K16) },
        { name: 'META-INF/UPLOAD.RSA', data: pkcs7([der(RELEASE_CERT)]) },
      ],
      {},
    ),
  ];
}
