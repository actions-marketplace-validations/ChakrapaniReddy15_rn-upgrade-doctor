# Commands

Every command for working on and testing rn-upgrade-doctor, with what it does and why.
Run them from the repository folder (where `package.json` is) unless a section says otherwise:

```bash
git clone https://github.com/ChakrapaniReddy15/rn-upgrade-doctor.git
cd rn-upgrade-doctor
```

## Why `node dist/cli.js` and not `npx rn-upgrade-doctor`?

The tool is written in TypeScript (`src/*.ts`). Node.js cannot run TypeScript files directly, and the package is
**not on npm yet**. That leaves four ways to run it:

| Command | What it runs | When to use it |
|---|---|---|
| `npx tsx src/cli.ts …` or `npm run dev -- …` | The TypeScript source, compiled in memory by `tsx` on every run | While changing code: no build step, edits show up immediately |
| `node dist/cli.js …` | The compiled JavaScript in `dist/`, made by `npm run build` | Testing what users will get: `dist/` is exactly what is published to npm |
| `rn-upgrade-doctor …` (after `npm link`) | The same `dist/cli.js`, through a global command on your Mac | Testing it like an installed tool, from any folder |
| `npx rn-upgrade-doctor …` | The package downloaded from npm | **Only after it is published.** Until then npm answers "404 Not Found", or, if someone else ever took the name, runs *their* code |

All four take the same arguments. `node dist/cli.js` needs a fresh `npm run build` after every code change; the others
don't, except `npm link`, which also points at `dist/`.

## 1. Setup

| Command | What it does |
|---|---|
| `npm ci` | Installs dependencies exactly as recorded in `package-lock.json` (clean, repeatable). Use this normally. |
| `npm install` | Installs dependencies and may update `package-lock.json`. Use it when adding or upgrading a dependency. |

## 2. Build and checks

| Command | What it does |
|---|---|
| `npm run build` | Compiles `src/` to `dist/` with the TypeScript compiler. Needed before `node dist/cli.js` and before publishing. |
| `npm run lint` | Type-checks `src/`, `test/` and `scripts/` without writing files. Catches type errors the tests might miss. |
| `npm test` | Runs every test once (Vitest), offline: unit tests, the example scenarios and their JSON snapshots. |
| `npm run test:watch` | Re-runs tests on every file save. Handy while coding. |
| `npx vitest run test/examples.test.ts` | Runs one test file only. |
| `npx vitest run -u` | **Accepts** changed snapshots. Only run it after reading the diff in a failed test and agreeing the change is intended. |

## 3. Example scenarios (`examples/`)

Text-only sample projects, one per check. They run offline against the frozen data in `examples/registry-snapshot/`.

| Command | What it does |
|---|---|
| `npm run examples` | Generates the two test APKs, runs every example and prints each report. Ends with "18/18 examples exited as expected". |
| `npx tsx scripts/make-example-apks.ts` | Only (re)generates `examples/09-16kb-apk/good.apk` and `bad.apk` (gitignored). |
| `npm run demo` | Re-records `docs/demo.gif` from `docs/demo.tape` (needs [vhs](https://github.com/charmbracelet/vhs): `brew install vhs`). Uses the examples, so no local paths appear. |
| `node dist/cli.js examples/10-everything-broken --offline --cache-dir examples/registry-snapshot` | One example with every problem at once. Good for screenshots and the README GIF. |
| `node dist/cli.js examples/09-16kb-apk --apk examples/09-16kb-apk/bad.apk --offline --cache-dir examples/registry-snapshot` | The 16 KB page-size scan on an APK with problems. Run `npm run examples` once first to create the APK. |
| `node dist/cli.js examples/14-monorepo/apps/mobile --offline --cache-dir examples/registry-snapshot` | A monorepo app: lockfile and patches come from the workspace root (`../../`). |

`examples/README.md` lists every example with its expected exit code and findings.

## 4. Scanning a real project

Use apps you are allowed to scan; don't commit their names or reports to this repository.

| Command | What it does |
|---|---|
| `node dist/cli.js "/path/to/your-rn-app"` | Scans the app online (npm registry + React Native Directory) and prints the report. |
| `node dist/cli.js "/path/to/monorepo/apps/mobile"` | Monorepo: point at the app folder; the workspace root is found automatically. |
| `node dist/cli.js "/path/to/your-rn-app" --format terminal,html --out /tmp/rn-doctor-out` | Also writes an HTML report to `/tmp/rn-doctor-out` (not into your project). |
| `open /tmp/rn-doctor-out/rn-upgrade-doctor-report.html` | Opens that HTML report in the browser (macOS). |
| `node dist/cli.js "/path/to/your-rn-app" --format json --out /tmp/rn-doctor-out` | Writes the full report as JSON, for scripts or for comparing runs. |
| `node -e 'const r=require("/tmp/rn-doctor-out/rn-upgrade-doctor-report.json"); console.log(r.meta, r.android, r.ios)'` | Prints parts of the JSON report: versions and lockfile used, Android and iOS config. |
| `node dist/cli.js "/path/to/your-rn-app" --apk "/path/to/app-release.apk"` | Adds the 16 KB page-size scan of a release build. Run your package manager install in the app first, so each `.so` can be mapped to its npm package. |
| `node dist/cli.js "/path/to/your-rn-app" --offline` | No network: uses only the cache from earlier runs. Packages not in the cache are reported as missing data. |
| `node dist/cli.js "/path/to/your-rn-app" --ci` | CI mode: no colours, and exit code `2` if npm or React Native Directory cannot be reached. |
| `echo $?` | Run right after a scan to see its exit code: `0` no blockers, `1` blockers, `2` the tool could not run. |

All flags: `node dist/cli.js --help`. Version: `node dist/cli.js --version`.

### Check a built APK without the source code

| Command | What it does |
|---|---|
| `node dist/cli.js --apk ~/Downloads/app-release.apk` | Run in a folder without a React Native project: checks only the APK (16 KB pages and Google Play rules). Sends nothing over the network. |
| `node dist/cli.js --apk examples/15-play-store/debug-signed.apk` | One of the example APKs (run `npx tsx scripts/make-example-apks.ts` first); each has one Play Store problem. |
| `node dist/cli.js "/path/to/your-rn-app" --apk "/path/to/app-release.apk"` | Full project report plus the "Play Store ready?" section for the build. |

### Finding paths

| Command | What it does |
|---|---|
| `pwd` | Prints the folder your terminal is in. |
| `find ~ -maxdepth 5 -name package.json -not -path "*/node_modules/*" -not -path "*/Library/*" -exec grep -l '"react-native":' {} + 2>/dev/null \| xargs -n1 dirname` | Lists React Native project folders under your home folder (macOS/Linux). |
| `find "/path/to/your-rn-app/android/app/build/outputs" \( -name "*.apk" -o -name "*.aab" \)` | Lists built APK/AAB files in an app. |

Paths with spaces (like `~/My Apps/shop`) must be in quotes.

## 5. Use it as a global command (`npm link`)

| Command | What it does |
|---|---|
| `npm run build && npm link` | Creates a global `rn-upgrade-doctor` command that runs this folder's `dist/cli.js`. |
| `cd "/path/to/your-rn-app" && rn-upgrade-doctor` | Scans the current folder, as users will after installing. |
| `npm unlink -g rn-upgrade-doctor` | Removes the global command again. |

After code changes, run `npm run build` again; the linked command uses `dist/`.

## 6. Test the package exactly as npm users will get it

| Command | What it does |
|---|---|
| `npm pack --dry-run` | Lists the files that would be published (should be `dist/`, `README.md`, `LICENSE`, `package.json`). Nothing is uploaded. |
| `npm pack --pack-destination /tmp` | Builds the real package file, `/tmp/rn-upgrade-doctor-0.2.0.tgz`. |
| `npx --yes --package /tmp/rn-upgrade-doctor-0.2.0.tgz rn-upgrade-doctor --version` | Installs that file in a temporary place and runs it, just like `npx rn-upgrade-doctor` after publishing. |
| `npx --yes --package /tmp/rn-upgrade-doctor-0.2.0.tgz rn-upgrade-doctor "/path/to/your-rn-app"` | Scans a project with the packed version. |

## 7. Registry cache

| Command | What it does |
|---|---|
| `ls ~/.cache/rn-upgrade-doctor` | Shows the cache: `npm-latest/` (kept 12 h) and `rn-directory/` (kept 24 h). |
| `rm -rf ~/.cache/rn-upgrade-doctor` | Clears the cache, so the next online run fetches everything fresh. |
| `node dist/cli.js "/path/to/app" --cache-dir /tmp/rn-doctor-cache` | Uses a different cache folder for one run (also: `RN_UPGRADE_DOCTOR_CACHE_DIR`). |

## 8. Git and publishing (maintainers)

| Command | What it does |
|---|---|
| `git status` | Shows changed and new files. |
| `git diff` | Shows the changes in tracked files. |
| `git add -A && git commit -m "…"` | Commits everything. Review `git status` first. |
| `git push` | Pushes to GitHub; CI (lint, test, build) runs on every push. Check the Actions tab. |
| `npm login` | Signs in to npm (once). |
| `npm publish` | Publishes `dist/` to npm as `rn-upgrade-doctor`. Run `npm run build`, `npm test` and `npm pack --dry-run` first. |
| `git tag v0.2.0 && git push --tags` | Tags the release, so the GitHub Action can be used as `ChakrapaniReddy15/rn-upgrade-doctor@v0.2.0`. |
