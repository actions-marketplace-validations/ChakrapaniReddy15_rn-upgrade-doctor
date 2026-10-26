# Changelog

## 0.2.0 — 2026-10-26

Check a built APK or AAB for Google Play, with or without the source code.

- **APK-only mode:** `rn-upgrade-doctor --apk app-release.apk` in a folder without a React Native project checks just
  the built app (no network access). The report header says "APK-only scan (no project found)".
- **AndroidManifest.xml from the APK** (compiled binary XML): package, version, min/target SDK, debuggable, cleartext,
  network security config, permissions, and components with their intent filters and `android:exported`.
  Verified against `aapt2`. AABs store a protobuf manifest, so manifest checks need the APK.
- **Signing:** v1, v2, v3 and v3.1 schemes, the Android debug key, and every signer certificate (subject, SHA-256 as
  Play Console shows it, validity), read with Node's built-in X.509 parser. Verified against `apksigner`.
- **Google Play rules** (one data file, `src/rules/playStore.ts`), each with a fix and a docs link:
  blockers for target API below 36, no 64-bit ABI, debuggable, unsigned, debug key, v1-only signing on Android 11+
  targets, expired certificate or validity before 22 Oct 2033, and missing `android:exported` on Android 12+ targets;
  warnings for permissions that need a Play Console declaration and for cleartext traffic. 16 KB results count too.
- **"Play Store ready?"** section in the terminal, HTML, Markdown and JSON reports: ✅ ready, or ❌ blockers and ⚠️
  warnings with the fix list, plus the app's package, version, SDK levels, signer and SHA-256. Exit code 1 on any
  Play blocker. Findings show their docs links.
- **Examples:** `examples/15-play-store` has one generated APK per Play rule, plus an AAB; the GitHub Action is also
  tested on an APK without a project.
- **Fixes:** the 16 KB "all compatible" line counts libraries, not their per-ABI copies.

## 0.1.0 — 2026-10-13

First release.

- **React Native version gap** to the latest release, with a link to the official upgrade-helper diff; warnings for the
  New Architecture-only releases (0.82+) and for releases older than 0.77 (16 KB page sizes).
- **Dependencies:** installed (from the lockfile) vs latest; New Architecture support and maintenance status from
  React Native Directory; deprecated packages and known replacements. Tooling pinned by the React Native template is
  compared with the template's version instead of npm latest.
- **Native settings vs the React Native template** for your current and the target version: targetSdk, compileSdk,
  minSdk, build tools, NDK, Kotlin, Gradle, New Architecture, Hermes and the iOS deployment target. Google Play's
  target API level (36) is checked.
- **16 KB page-size scan** of a built APK or AAB (`--apk`): ELF segment alignment and zip alignment of every 64-bit
  native library, each mapped to the npm package behind it. Matches Google's `zipalign -c -P 16` and `llvm-readelf`.
- **16 KB summary in plain words:** a verdict, libraries counted once (not per ABI), failures split into "one build
  fix for all" (zip alignment) and "upgrade these packages" (4 KB ELF), grouped per package, plus Google's own check.
- **patch-package and pnpm patches** that need re-checking.
- **Lockfiles:** npm (v1–v3), Yarn classic and Berry, pnpm (v5–v9); monorepo workspaces.
- **Reports:** terminal, HTML, Markdown and JSON; findings ranked blocker, warning, info and grouped per package.
  Every value says where its data came from; missing data is reported, never silently skipped.
- **Offline mode** with a local cache (`--offline`, `--cache-dir`). Colours follow `FORCE_COLOR` / `NO_COLOR`.
- **GitHub Action:** job summary, pull request comment, fail on blockers; `offline` and `cache-dir` inputs. Tested on
  GitHub runners on every push (`.github/workflows/action-test.yml`).
- Exit codes: 0 no blockers, 1 blockers, 2 the tool could not run (or, with `--ci`, a registry was unreachable).
