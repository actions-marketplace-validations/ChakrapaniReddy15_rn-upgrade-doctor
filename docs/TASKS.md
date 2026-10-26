# Roadmap

## Setup
- [x] Repository, plan docs, CLAUDE.md, package.json, tsconfig, folder skeleton
- [x] npm name `rn-upgrade-doctor` is free
- [x] Public GitHub repository and CI (lint, test, build)
- [x] Example scenarios: text-only projects in `examples/` covering every finding id (offline, registry snapshot)
- [x] A real app from the public RN 0.87.1 template under `fixtures/` (git-ignored) with a release APK: scan matches
      Google's `zipalign -c -P 16` and `llvm-readelf` on all 22 libraries; clean report (0 findings) on the fresh app
- [ ] A real app with a library that is *not* 16 KB ready, to see a real failing APK end to end

## Version gap and dependency report
- [x] `src/project`: read package.json, detect RN version, detect package manager
- [x] Lockfile parsers: package-lock.json, yarn.lock (classic + Berry), pnpm-lock.yaml -> installed versions
- [x] Monorepos: find the workspace root (npm/yarn workspaces, pnpm-workspace.yaml) for lockfile, patches, node_modules
- [x] `src/registry`: npm registry client with cache and offline mode
- [x] React Native Directory client (New Architecture support, unmaintained)
- [x] Findings model + ranking; missing-data findings
- [x] Tests for each parser with small inline fixtures

## 16 KB page-size scan
- [x] `src/apk`: list .so files in APK/AAB (lib/<abi>/ and <module>/lib/<abi>/)
- [x] ELF parser: read program headers, check PT_LOAD p_align >= 16384
- [x] APK: check uncompressed .so entries are 16 KB aligned in the zip
- [x] Map .so -> npm package (node_modules search + known table)

## Checks, reports, CI
- [x] Android Gradle + iOS Podfile checks; patch-package detection
- [x] Native settings vs the React Native template for the current and target version (rn-diff-purge), cached permanently
- [x] Terminal, HTML, Markdown, JSON renderers, including Android/iOS config
- [x] GitHub Action (composite) + example workflow
- [x] Action self-test on GitHub runners (healthy app, blocker, 16 KB APK, fail-on-blockers), offline and deterministic

## Release
- [x] Play policy checked 2026-10-13: target API 36 since 31 Aug 2026; 16 KB required for updates from 1 Feb 2027
- [x] README with a demo GIF
- [x] Release prep: version 0.1.0, CHANGELOG, README
- [x] Publish v0.1 to npm; tag `v0.1.0`

## v0.2: Play Store check of an APK
- [x] APK-only mode: `--apk` outside a React Native project
- [x] Binary AndroidManifest.xml parser (verified against aapt2)
- [x] Signing schemes, debug key and signer certificates (verified against apksigner)
- [x] Google Play rules with fixes and docs links (`src/rules/playStore.ts`)
- [x] "Play Store ready?" section in every report format; exit code 1 on Play blockers
- [x] Example APKs for every rule (`examples/15-play-store`), CLI and GitHub Action tests
- [ ] Publish v0.2.0 to npm; tag `v0.2.0` and create the GitHub release

## Later
- [ ] Cryptographic signature verification (v2/v3 digests), to catch APKs changed after signing
- [ ] Manifest checks for AABs (protobuf manifest)
- [x] Ranking within a severity (dev-only packages last; their deprecation, replacement and version findings as info)
- [x] One entry per package in the reports (JSON keeps one finding per problem)
- [x] More known replacements in `src/rules/libraries.ts`
- [x] Tooling pinned by the React Native template compared with the template, not npm latest
- [ ] `--to <version>` to check against a chosen target instead of the latest React Native
- [ ] GitHub client: archived repositories, last commit
- [ ] Expo projects
