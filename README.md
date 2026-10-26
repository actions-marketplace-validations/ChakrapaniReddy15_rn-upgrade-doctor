# rn-upgrade-doctor

[![npm](https://img.shields.io/npm/v/rn-upgrade-doctor)](https://www.npmjs.com/package/rn-upgrade-doctor)
[![CI](https://github.com/ChakrapaniReddy15/rn-upgrade-doctor/actions/workflows/ci.yml/badge.svg)](https://github.com/ChakrapaniReddy15/rn-upgrade-doctor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/ChakrapaniReddy15/rn-upgrade-doctor/blob/main/LICENSE)

One command to see what will break when you upgrade a React Native app, and what to fix first.

![rn-upgrade-doctor: blockers first, findings grouped per package, and the 16 KB page-size scan of a release APK](https://raw.githubusercontent.com/ChakrapaniReddy15/rn-upgrade-doctor/main/docs/demo.gif)

Requires Node.js 20 or newer. Works with npm, Yarn (classic and Berry) and pnpm projects, including monorepos.
Expo-managed projects are not supported yet, but their built APK can be checked with `--apk` (any Android APK can).

```bash
npx rn-upgrade-doctor                                   # scan the project in the current folder
npx rn-upgrade-doctor ./apps/mobile                     # scan another folder (monorepo apps work too)
npx rn-upgrade-doctor --apk app-release.apk             # also check the release build: 16 KB pages, Google Play rules
npx rn-upgrade-doctor --apk ~/Downloads/app-release.apk # outside a project: check just the APK, no source code needed
npx rn-upgrade-doctor --format terminal,html --out reports
```

## Try it

The [`examples/`](examples) folder has small text-only projects, one per scenario (healthy app, old React Native,
New Architecture blockers, bad Gradle config, old Podfile, patches, 16 KB APK scan, ...). They run offline:

```bash
npm install
npm run examples                                       # every scenario, terminal output
npx tsx src/cli.ts examples/10-everything-broken --offline --cache-dir examples/registry-snapshot
```

## Check an APK without the source code

Run it with `--apk` in any folder that has no React Native project (or on an APK from someone else) and it checks only
the built app: **"Is this build ready for Google Play?"**

```bash
npx rn-upgrade-doctor --apk ~/Downloads/app-release.apk
```

```
rn-upgrade-doctor · APK-only scan (no project found)
~/Downloads/app-release.apk

1 blocker  0 warnings  2 info

16 KB page size  ✓ Ready: the only native library supports 16 KB pages
  app-release.apk · 1 native library × 2 ABIs (arm64-v8a, x86_64)

Play Store ready?  ❌ 1 blocker
  com.demo.scanner 1.0 (1) · minSdk 24 · targetSdk 36
  signed: v2, v3 · CN=Android Debug, O=Android, C=US · valid until 2055-12-25
  SHA-256 DB:77:2D:CB:26:BA:28:F3:88:81:CD:0F:2C:3E:A6:D3:A2:2A:35:93:7A:01:1B:5B:C4:57:E3:3F:15:34:56:5A (compare with Play Console > Setup > App signing > Upload key certificate)

  ✖ Signed with the Android debug key (CN=Android Debug)
      → Create an upload key and use it in the release signingConfig of android/app/build.gradle.
        https://developer.android.com/studio/publish/app-signing
  ℹ Google Play needs an Android App Bundle (AAB) for new apps; this APK check is a pre-upload check
```

(Output from [`examples/15-play-store/debug-signed.apk`](examples/15-play-store/README.md), shortened.)

It reads the APK's compiled `AndroidManifest.xml` and its signature, and checks:

| Severity | Check |
|---|---|
| Blocker | 16 KB page-size support of every 64-bit native library |
| Blocker | `targetSdkVersion` below Google Play's minimum (36 for new apps and updates since 31 Aug 2026) |
| Blocker | Native libraries without a 64-bit ABI (`arm64-v8a` / `x86_64`) |
| Blocker | `android:debuggable="true"` |
| Blocker | Unsigned, signed with the Android debug key, or signed only with v1 while targeting Android 11+ |
| Blocker | Signing certificate expired, or valid only until before 22 Oct 2033 (Google Play's minimum) |
| Blocker | Activity, service or receiver with an intent filter but no `android:exported` (targeting Android 12+) |
| Warning | Permissions that need a Play Console declaration: SMS, Call Log, background location, all files access, `QUERY_ALL_PACKAGES`, `REQUEST_INSTALL_PACKAGES` |
| Warning | Cleartext HTTP allowed for all domains (`android:usesCleartextTraffic="true"`) |

Every finding has a one-line fix and a link to the official Android or Play Console page. The exit code is `1` when
there is a blocker, so it works as a CI gate. The report also shows the signing certificate's SHA-256, to compare with
the upload key in Play Console. With a project in the folder, the same checks run as part of the full report.

**AABs:** the 16 KB scan and the signature checks work on an `.aab`; the manifest checks need the APK, because an
AAB stores its manifest in protobuf format. Google Play needs an AAB for new apps, so this is a pre-upload check of
the same build.

## What it checks

| Area | Checks | Data source |
|---|---|---|
| React Native | Version gap to the latest release, link to the [upgrade helper](https://react-native-community.github.io/upgrade-helper/) diff, New Architecture-only releases (0.82+), 16 KB support (0.77+) | lockfile, npm registry, rules |
| Dependencies | Installed vs latest, New Architecture support, unmaintained / deprecated packages, known replacements | lockfile, npm registry, [React Native Directory](https://reactnative.directory) |
| Android | Your targetSdk, compileSdk, minSdk, build tools, NDK, Kotlin, Gradle, `newArchEnabled`, `hermesEnabled` side by side with the official React Native template for your version and the target version; targetSdk vs Google Play minimum | `android/*.gradle`, `gradle.properties`, [React Native template](https://github.com/react-native-community/rn-diff-purge) |
| iOS | Deployment target vs the template's minimum, `RCT_NEW_ARCH_ENABLED`, Podfile.lock in sync | `ios/Podfile`, `ios/Podfile.lock`, React Native template |
| 16 KB page size | ELF `PT_LOAD` alignment of every 64-bit `.so`, 16 KB zip alignment of uncompressed `.so` in APKs, each library mapped to its npm package | `--apk` file, `node_modules` |
| Google Play | targetSdk, 64-bit ABIs, debuggable, signing (debug key, v1-only, certificate validity), `android:exported`, sensitive permissions, cleartext traffic (see [above](#check-an-apk-without-the-source-code)) | `--apk` file: manifest and signature |
| Patches | patch-package and pnpm patches that need re-checking, or no longer match the installed version | `patches/`, `package.json` |

Every finding says where its data came from. Findings are ranked: **blockers** (will break the build or the Play Store release), **warnings** (fix during the upgrade), **info**.

## Options

| Option | Default | |
|---|---|---|
| `[path]` or `--cwd <path>` | current folder | React Native project folder |
| `--apk <path>` | | APK or AAB to check (16 KB pages, Google Play rules), relative to the current folder. Without a React Native project in the folder, only the APK is checked. In a project, run `npm install` first so libraries can be mapped to packages. |
| `--format <list>` | `terminal` | Any of `terminal`, `html`, `md`, `json` |
| `--out <dir>` | project folder | Where `rn-upgrade-doctor-report.{html,md,json}` are written |
| `--ci` | off | No colours; exit `2` if npm or React Native Directory cannot be reached, so a network failure never passes as clean |
| `--offline` | off | No network; use cached registry data only |
| `--cache-dir <dir>` | `~/.cache/rn-upgrade-doctor` | Registry cache folder (also `RN_UPGRADE_DOCTOR_CACHE_DIR`) |
| `-v, --version` | | Print the version |

Exit codes: `0` no blockers, `1` blockers found, `2` the tool could not run (for example, not a React Native project) or, with `--ci`, a registry was unreachable.

**Monorepos:** point it at the app folder (`apps/mobile`). When the app has no lockfile of its own, the tool looks in parent
folders for the workspace root (a lockfile plus `workspaces` in `package.json`, or `pnpm-workspace.yaml`), without leaving
the git repository. `patches/` and hoisted `node_modules` are read from there too.

**Missing data is reported**, never silently skipped: no lockfile, or registry data that could not be fetched, becomes a
warning in the report.

See [docs/COMMANDS.md](docs/COMMANDS.md) for every command with an explanation.

Registry responses are cached in `~/.cache/rn-upgrade-doctor` (npm: 12 h, React Native Directory: 24 h, React Native
templates: permanently, since a release's template never changes). Use `--cache-dir` or `RN_UPGRADE_DOCTOR_CACHE_DIR` to move it.

**Native settings vs the React Native template:** the "latest" value for an Android or iOS setting is what a new app
created on that React Native version uses. The tool reads it from the same public data the official upgrade helper uses
(`react-native-community/rn-diff-purge`) and shows your value next to the template of your current version and of the
target version. Statuses: *below the minimum* (minSdk, iOS target, Play's targetSdk), *raised by the upgrade*,
*behind your RN version* (drift you already have), *newer* (fine). Template values other than the minimums are
recommendations, not hard rules.

## What it sends over the network

No source code and no APK ever leave your machine. Online runs only send:

- **package names** to the npm registry (`registry.npmjs.org`), to get each package's latest version;
- **package names** to React Native Directory (`reactnative.directory`), for New Architecture support and maintenance;
- **React Native version numbers** to GitHub (`raw.githubusercontent.com`), to read the official app template for that
  version.

With `--offline` nothing is sent; only the local cache is used. An APK-only scan (`--apk` without a project) sends nothing.

## GitHub Action

Adds the Markdown report to the job summary, can comment on the pull request, and fails the job on blockers.
See [docs/examples/rn-upgrade-doctor.yml](docs/examples/rn-upgrade-doctor.yml).

```yaml
- uses: actions/checkout@v4
- uses: ChakrapaniReddy15/rn-upgrade-doctor@v0.2.0
  with:
    comment: true            # needs permissions: pull-requests: write
    fail-on-blockers: true
    # apk: android/app/build/outputs/apk/release/app-release.apk
```

| Input | Default | |
|---|---|---|
| `working-directory` | `.` | React Native app folder (e.g. `apps/mobile` in a monorepo) |
| `apk` | | APK or AAB to check (16 KB pages, Google Play rules), relative to `working-directory`. With no React Native project there, only the APK is checked |
| `fail-on-blockers` | `true` | Fail the job when the report has blockers |
| `comment` | `false` | Post or update the report as a pull request comment |
| `offline` / `cache-dir` | `false` / `~/.cache/rn-upgrade-doctor` | Use cached registry data; combine `cache-dir` with `actions/cache` to reuse it between runs |

Outputs: `blockers`, `warnings`, `report-dir` (folder with the Markdown, JSON and HTML reports).

## Library use

```ts
import { runScan, renderReport } from 'rn-upgrade-doctor';

const report = await runScan({ cwd: '.', format: ['json'], ci: true, offline: false });
console.log(report.summary, renderReport(report, 'md'));
```

## How it compares

| Tool | What it does | What rn-upgrade-doctor adds |
|---|---|---|
| [React Native Upgrade Helper](https://react-native-community.github.io/upgrade-helper/) | Diff of the template files between two React Native versions | Looks at *your* project: dependencies, your Android/iOS settings, your built app; links to the helper diff |
| [React Native Directory](https://reactnative.directory) | New Architecture support and maintenance per library | Installed vs latest for every dependency, one ranked report, a CLI and CI gate |
| `expo doctor` | Health checks for Expo projects | Bare React Native apps and monorepos, native settings vs the template, 16 KB scan of the built app |
| Google's 16 KB checks (`zipalign -c -P 16`, ELF alignment script) | Alignment of each `.so` file in an APK | Names the npm package behind each failing library and the fix, and says when one build setting fixes all of them |

## Limitations

- **Expo-managed apps** (no `android/` and `ios/` folders) are not supported yet; their built APK can be checked with `--apk`.
- **Signatures are inspected, not cryptographically verified.** The tool reads the schemes and certificates, but does
  not recompute the signed digests, so an APK changed after signing still passes here. Use
  `apksigner verify` (Android SDK build-tools) for that.
- **Google Play rules** are as of the date in `src/rules/playStore.ts`; Play raises the target API level every August.
- **Manifest checks need an APK**; for an AAB, the 16 KB scan and the signature checks still run.
- **Template values** other than the minimums (minSdk, iOS deployment target, Play's targetSdk) are recommendations:
  being behind the template is a warning, not a blocker.
- **Mapping `.so` files to packages** needs your dependencies installed (`node_modules`). Libraries that come from
  Maven are matched through a known table; anything else is reported as an unknown package.
- **The 16 KB check needs a built APK or AAB** (`--apk`); without it the report says the check did not run.
- **Registry data** can be missing (offline without a cache, or a service that cannot be reached). The report says so
  instead of treating it as a clean result.

## Need help with a React Native upgrade?

I built RN Upgrade Doctor after migrating production apps from 0.64 → 0.84 and 0.75 → 0.84.1 to the New Architecture. If you're stuck on an upgrade, feel free to connect or message me on [LinkedIn](https://www.linkedin.com/in/chakrapani-reddy-977846140).

## Development

```bash
npm install
npm run dev -- ../my-rn-app         # run from source (no build needed)
npm run examples                    # run every example scenario
npm run demo                        # re-record docs/demo.gif (needs vhs)
npm test                            # Vitest
npm run lint                        # type-check src and tests
npm run build                       # compile to dist/
```

MIT © Sunkesula Chakrapani Reddy
