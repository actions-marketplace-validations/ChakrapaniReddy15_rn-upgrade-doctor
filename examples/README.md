# Examples

Small scenario projects that show every check rn-upgrade-doctor does. They are **text only**: a `package.json`, a
lockfile and just the `android/`, `ios/` and `patches/` files a scenario needs. There is no `node_modules` and nothing to
build. App names are made up (`demo-shop`, `demo-fleet`, ...).

Run them all (generates the APKs for 09 first):

```bash
npm run examples
```

Every command below runs offline against [`registry-snapshot/`](registry-snapshot), so results don't change when npm
or React Native Directory change. Drop `--offline --cache-dir examples/registry-snapshot` to use live data instead.

| Folder | Scenario | Command | Exit | Key finding ids |
|---|---|---|---|---|
| `01-healthy-latest` | Latest RN (0.87.1 in the snapshot); Android settings equal to the 0.87.1 template; New Architecture and Hermes on; maintained libraries | `npx tsx src/cli.ts examples/01-healthy-latest --offline --cache-dir examples/registry-snapshot` | 0 | none |
| `02-old-rn-version` | RN 0.68.7, 19 releases behind; report links the upgrade-helper diff | `npx tsx src/cli.ts examples/02-old-rn-version --offline --cache-dir examples/registry-snapshot` | 0 | `rn-version-gap` (warning), `rn-new-arch-only`, `rn-16kb`, `dep-outdated:react` (info) |
| `03-new-arch-blockers` | Libraries without New Architecture support, on a target RN that is New Architecture only | `npx tsx src/cli.ts examples/03-new-arch-blockers --offline --cache-dir examples/registry-snapshot` | 1 | `dep-new-arch:react-native-fast-image`, `dep-new-arch:@demo/legacy-maps` (blockers), `dep-new-arch-untested:@demo/untested-charts`, `dep-replace:react-native-fast-image` |
| `04-unmaintained-deps` | Unmaintained, deprecated and replaced libraries | `npx tsx src/cli.ts examples/04-unmaintained-deps --offline --cache-dir examples/registry-snapshot` | 1 | `dep-replace:react-native-code-push`, `dep-replace:react-native-camera`, `dep-deprecated:request`, `dep-unmaintained:@demo/abandoned-picker`, `dep-outdated:react-native-mmkv`, `dep-new-arch:react-native-code-push` (blocker, see note) |
| `05-android-config` | targetSdk 34, compileSdk 33, minSdk 21, Gradle 7.5.1, `newArchEnabled=false`, `hermesEnabled=false` | `npx tsx src/cli.ts examples/05-android-config --offline --cache-dir examples/registry-snapshot` | 1 | `android-target-sdk` (blocker), `android-compile-sdk`, `android-min-sdk`, `android-template-gap`, `android-new-arch-off`, `android-hermes-off` |
| `06-ios-podfile` | Old-style Podfile: `platform :ios, '12.4'`, `RCT_NEW_ARCH_ENABLED=0`, Flipper; Podfile.lock from RN 0.79.2 | `npx tsx src/cli.ts examples/06-ios-podfile --offline --cache-dir examples/registry-snapshot` | 0 | `ios-min-version`, `ios-new-arch-off`, `ios-pods-out-of-sync` |
| `07-patch-package` | Two patch-package patches (one for the installed version, one for an older one) and a `postinstall` script | `npx tsx src/cli.ts examples/07-patch-package --offline --cache-dir examples/registry-snapshot` | 0 | `patch:@demo/js-utils` (warning), `patch:react-native-mmkv` (info), `dep-outdated:@demo/js-utils` (info) |
| `08-lockfiles/npm` | Same app as yarn and pnpm, with `package-lock.json` | `npx tsx src/cli.ts examples/08-lockfiles/npm --offline --cache-dir examples/registry-snapshot` | 0 | `rn-version-gap` (info) |
| `08-lockfiles/yarn` | Same app, Yarn classic `yarn.lock` | `npx tsx src/cli.ts examples/08-lockfiles/yarn --offline --cache-dir examples/registry-snapshot` | 0 | `rn-version-gap` (info) |
| `08-lockfiles/pnpm` | Same app, `pnpm-lock.yaml` v9 | `npx tsx src/cli.ts examples/08-lockfiles/pnpm --offline --cache-dir examples/registry-snapshot` | 0 | `rn-version-gap` (info) |
| `09-16kb-apk` | 16 KB scan of a compatible APK | `npx tsx src/cli.ts examples/09-16kb-apk --apk examples/09-16kb-apk/good.apk --offline --cache-dir examples/registry-snapshot` | 0 | `apk-16kb-ok` |
| `09-16kb-apk` | 16 KB scan: a 4 KB-aligned `.so`, an uncompressed `.so` off the 16 KB boundary, and one with no known package | `npx tsx src/cli.ts examples/09-16kb-apk --apk examples/09-16kb-apk/bad.apk --offline --cache-dir examples/registry-snapshot` | 1 | `apk-16kb:react-native-reanimated`, `apk-16kb:react-native-mmkv`, `apk-16kb:libdemo_native.so` (blockers) |
| `10-everything-broken` | Every problem at once (for the README GIF and screenshots) | `npx tsx src/cli.ts examples/10-everything-broken --offline --cache-dir examples/registry-snapshot` | 1 | 27 findings: all of 02–07 together |
| `11-unknown-rn-version` | `react-native` from a git URL, no lockfile, so there is no version to compare | `npx tsx src/cli.ts examples/11-unknown-rn-version --offline --cache-dir examples/registry-snapshot` | 0 | `rn-version-unknown`, `data-lockfile-missing` |
| `12-not-an-rn-app` | A web app without `react-native` | `npx tsx src/cli.ts examples/12-not-an-rn-app --offline --cache-dir examples/registry-snapshot` | 2 | none (tool error) |
| `13-registry-data-missing` | A dependency and an RN version (0.86.0) whose data is not in the snapshot, like being offline without a cache | `npx tsx src/cli.ts examples/13-registry-data-missing --offline --cache-dir examples/registry-snapshot` | 0 | `data-registry-unavailable`, `data-template-unavailable` |
| `14-monorepo` | Yarn workspaces: the app is in `apps/mobile`; `yarn.lock` and `patches/` are at the monorepo root | `npx tsx src/cli.ts examples/14-monorepo/apps/mobile --offline --cache-dir examples/registry-snapshot` | 0 | `patch:react-native-mmkv` (from `../../patches/`), RN version from `../../yarn.lock` |
| `15-play-store` | **No project, only built apps** (APK-only mode): 12 APKs and an AAB, one Google Play problem each; see [its README](15-play-store/README.md) | `npx tsx src/cli.ts --apk examples/15-play-store/debug-signed.apk` | 0 or 1 | `play-target-sdk`, `play-debuggable`, `play-debug-signed`, `play-exported`, `play-64bit`, `play-unsigned`, `play-v1-only`, `play-cert-expired`, `play-cert-validity` (blockers); `play-permission:*`, `play-cleartext` (warnings) |

The full expected findings for each run are in [`scripts/examples.ts`](../scripts/examples.ts); `test/examples.test.ts`
checks them, snapshots each JSON report, and fails if a finding id in `src/checks/` is not covered by an example.

## Notes

- **APKs for 09 and 15** are generated, not committed (`*.apk` and `*.aab` are gitignored): `npx tsx scripts/make-example-apks.ts`.
  The `.so` files inside are minimal ELF headers with no code, enough for the 16 KB checks. The `.so` → package
  mapping uses the known table in `src/rules/libraries.ts`, since examples have no `node_modules`.
- **04 has a blocker.** React Native Directory marks `react-native-code-push` as not supporting the New Architecture,
  and the snapshot's latest React Native (0.87.1) has no legacy architecture, so it is reported as a blocker.
- **Severity variants not shown here:** `dep-new-arch`, `android-new-arch-off` and `ios-new-arch-off` are milder
  when the target React Native still has the legacy architecture (below 0.82). The snapshot's latest is 0.87.1, so
  examples always show the stricter severity; the milder ones are covered by `test/checks.test.ts`.
- **11 has no lockfile** on purpose: a git dependency has no npm version for a lockfile to record.

## Registry snapshot

[`registry-snapshot/`](registry-snapshot) uses the same format as the tool's cache (`~/.cache/rn-upgrade-doctor`):
`npm-latest/<name>.json`, `rn-directory/<name>.json` and `rn-template/<version>.json`, each
`{ "fetchedAt": ..., "value": ... }`, where a `null` value means "not on npm" / "not listed in React Native Directory" /
"no template for this version".

- Real package names hold the values that registry.npmjs.org and reactnative.directory returned on **2026-10-13**.
- `rn-template/` holds the real React Native template values for 0.68.7, 0.85.2 and 0.87.1 (from rn-diff-purge).
- Packages named `@demo/*` are made up, so that no real library is shown with a status it doesn't have.
