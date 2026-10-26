# 15 – Play Store checks of an APK, without the source code

This folder has **no `package.json`**, so `rn-upgrade-doctor --apk <file>` runs an **APK-only scan**: no project files,
only the built app. The APKs and the AAB are generated (git-ignored) by:

```bash
npx tsx scripts/make-example-apks.ts
```

Each one has exactly one Play Store problem (manifests are compiled binary XML; signatures use throwaway test
certificates from `test/certs.ts`):

| File | Problem | Exit | Finding |
|---|---|---|---|
| `ready.apk` | none: release-signed, target API 36, 64-bit, 16 KB ready | 0 | ✅ Ready for Play Store |
| `target-sdk-34.apk` | targetSdkVersion 34 | 1 | `play-target-sdk` |
| `debuggable.apk` | `android:debuggable="true"` | 1 | `play-debuggable` |
| `debug-signed.apk` | signed with a `CN=Android Debug` certificate | 1 | `play-debug-signed` |
| `missing-exported.apk` | service and receiver with intent filters, no `android:exported` | 1 | `play-exported` |
| `32bit-only.apk` | native library only for armeabi-v7a | 1 | `play-64bit` |
| `sms-permission.apk` | `READ_SMS` | 0 | `play-permission:READ_SMS` (warning) |
| `cleartext.apk` | `android:usesCleartextTraffic="true"` | 0 | `play-cleartext` (warning) |
| `unsigned.apk` | no signature | 1 | `play-unsigned` |
| `v1-only.apk` | JAR (v1) signature only, target API 36 | 1 | `play-v1-only` |
| `cert-expired.apk` | certificate valid only in 2000 | 1 | `play-cert-expired` |
| `cert-before-2033.apk` | certificate ends 30 Jun 2033, before Play's 22 Oct 2033 minimum | 1 | `play-cert-validity` |
| `app-release.aab` | an AAB: its manifest is protobuf, so manifest checks need the APK | 0 | `play-manifest-unavailable` (info) |

Try one:

```bash
npx tsx src/cli.ts --apk examples/15-play-store/debug-signed.apk
```
