export type Severity = 'blocker' | 'warning' | 'info';

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  detail?: string;
  package?: string;
  fix?: string;
  /** Where the data came from, e.g. "npm registry", "React Native Directory", "APK scan". */
  source: string;
  /** Official documentation for the rule. */
  docs?: string;
}

export type ReportFormat = 'terminal' | 'html' | 'md' | 'json';

export interface ScanOptions {
  cwd: string;
  apk?: string;
  format: ReportFormat[];
  ci: boolean;
  offline: boolean;
  /** Registry cache folder. Default: $RN_UPGRADE_DOCTOR_CACHE_DIR, else ~/.cache/rn-upgrade-doctor. */
  cacheDir?: string;
}

/** A value fetched from a remote source, labelled with where it came from. */
export interface Sourced<T> {
  value?: T;
  /** e.g. "npm registry", "npm registry (cache)", "offline, not cached", "not on npm". */
  source: string;
}

export interface NpmPackageInfo {
  latest: string;
  deprecated?: string;
}

export type NewArchStatus = 'supported' | 'unsupported' | 'untested' | 'new-arch-only';

export interface DirectoryInfo {
  newArchitecture?: NewArchStatus;
  unmaintained: boolean;
}

export interface DependencyInfo {
  name: string;
  /** Range from package.json. */
  declared: string;
  /** Exact version from the lockfile. */
  installed?: string;
  dev: boolean;
  npm: Sourced<NpmPackageInfo>;
  /** Undefined value means the library is not listed in React Native Directory. */
  directory: Sourced<DirectoryInfo>;
}

export interface AndroidConfig {
  minSdk?: number;
  compileSdk?: number;
  targetSdk?: number;
  buildToolsVersion?: string;
  ndkVersion?: string;
  kotlinVersion?: string;
  gradleVersion?: string;
  newArchEnabled?: boolean;
  hermesEnabled?: boolean;
  /** Files the values were read from, relative to the project. */
  files: string[];
}

export interface IosConfig {
  /** e.g. "15.1"; undefined when the Podfile uses RN's `min_ios_version_supported`. */
  minIos?: string;
  usesRnMinIos: boolean;
  newArchEnabled?: boolean;
  hermesEnabled?: boolean;
  /** React Native version recorded in Podfile.lock (React-Core). */
  podsReactNativeVersion?: string;
  cocoapodsVersion?: string;
  files: string[];
}

/** Native settings of the official React Native app template for one release (see src/registry/template.ts). */
export interface TemplateInfo {
  version: string;
  android: Omit<AndroidConfig, 'files'>;
  /** Minimum iOS version: the Podfile literal, or React Native's own `min_ios_version_supported`. */
  minIos?: string;
  /** dependencies + devDependencies of the template's package.json (name -> range). */
  packages?: Record<string, string>;
}

/** Templates for the installed React Native version and for the upgrade target (the latest release). */
export interface NativeTemplates {
  currentVersion?: string;
  current: Sourced<TemplateInfo>;
  targetVersion?: string;
  target: Sourced<TemplateInfo>;
}

export type NativeStatus = 'ok' | 'newer' | 'raised' | 'behind' | 'below-required' | 'differs' | 'unknown';

/** One native setting: yours next to the template values for your current and the target React Native version. */
export interface NativeRow {
  platform: 'Android' | 'iOS';
  key: string;
  label: string;
  yours: string;
  current?: string;
  target?: string;
  status: NativeStatus;
}

export interface NativeComparison {
  currentVersion?: string;
  currentSource: string;
  targetVersion?: string;
  targetSource: string;
  rows: NativeRow[];
}

export interface PatchInfo {
  /** Path relative to the project. */
  file: string;
  package: string;
  /** Version the patch was made for (from the patch-package file name). */
  version?: string;
}

export interface NativeLib {
  /** Path inside the APK/AAB, e.g. "lib/arm64-v8a/libfoo.so". */
  path: string;
  abi: string;
  name: string;
  is64Bit: boolean;
  /** Smallest PT_LOAD alignment in bytes; undefined if the ELF could not be read. */
  loadAlign?: number;
  /** ELF segments aligned to 16 KB or more. Always true for 32-bit ABIs (not required there). */
  elfOk: boolean;
  /** Stored (uncompressed) in the zip. Only stored libs need 16 KB zip alignment. */
  stored: boolean;
  /** For stored libs in an APK: data offset in the zip is a multiple of 16 KB. */
  zipAligned?: boolean;
  package?: string;
  packageSource?: string;
}

/** An app component declared in the manifest. */
export interface ManifestComponent {
  type: 'activity' | 'activity-alias' | 'service' | 'receiver' | 'provider';
  /** Fully qualified class name. */
  name: string;
  /** android:exported; undefined when the attribute is missing. */
  exported?: boolean;
  hasIntentFilter: boolean;
}

/** The parts of AndroidManifest.xml the Play Store checks need. Undefined = attribute not set. */
export interface ApkManifest {
  package?: string;
  versionCode?: number;
  versionName?: string;
  minSdk?: number;
  targetSdk?: number;
  debuggable?: boolean;
  usesCleartextTraffic?: boolean;
  /** android:networkSecurityConfig is set on <application>. */
  networkSecurityConfig: boolean;
  /** uses-permission and uses-permission-sdk-23 names. */
  permissions: string[];
  components: ManifestComponent[];
}

export type SigningScheme = 'v1' | 'v2' | 'v3' | 'v3.1';

/** A signer certificate, for comparing with the upload key shown in Play Console (Setup > App signing). */
export interface SigningCertificate {
  /** e.g. "CN=Demo Release, O=Demo, C=US" */
  subject: string;
  /** SHA-256 fingerprint as Play Console shows it: "AB:CD:...". */
  sha256: string;
  /** ISO dates. */
  validFrom: string;
  validTo: string;
  /** Subject common name is "Android Debug". */
  debug: boolean;
  /** Schemes this certificate signs with. */
  schemes: SigningScheme[];
}

/** How the APK is signed. AABs only have v1 (JAR) signatures. */
export interface ApkSigning {
  /** Signature schemes found, in the order v1, v2, v3, v3.1. */
  schemes: SigningScheme[];
  /** A certificate's subject is "CN=Android Debug": the key Android tooling creates for local builds. */
  debugSigned: boolean;
  unsigned: boolean;
  /** Signer certificates, one entry per distinct certificate. */
  certificates: SigningCertificate[];
}

export type ManifestResult = { available: true; manifest: ApkManifest } | { available: false; reason: string };

export interface ApkReport {
  file: string;
  kind: 'apk' | 'aab';
  libs: NativeLib[];
  /** The parsed AndroidManifest.xml (APK only), or why it could not be read. */
  manifest?: ManifestResult;
  /** Signature schemes and debug-key detection; undefined if the file could not be read for it. */
  signing?: ApkSigning;
}

/** The "Play Store ready?" verdict for a scanned APK/AAB. */
export interface PlayStoreVerdict {
  /** No Play blockers (warnings still need review). */
  ready: boolean;
  blockers: number;
  warnings: number;
  /** Findings the verdict is based on: play-* rules and the 16 KB (apk-16kb:*) blockers, ranked. */
  findingIds: string[];
  /** From the manifest, when it could be read. */
  app?: { package?: string; versionName?: string; versionCode?: number; minSdk?: number; targetSdk?: number };
  /** Signing summary, to compare with the upload key in Play Console (Setup > App signing). */
  signing?: { schemes: SigningScheme[]; certificates: Array<Pick<SigningCertificate, 'subject' | 'sha256' | 'validTo'>> };
}

export interface ProjectContext {
  cwd: string;
  /** 'apk-only' when --apk was given and the folder has no React Native project: only the APK is checked. */
  mode?: 'project' | 'apk-only';
  /** Exact version from the lockfile, else the lowest version allowed by the package.json range. */
  reactNativeVersion?: string;
  reactNativeVersionSource?: 'lockfile' | 'package.json';
  /** The react-native range as written in package.json. */
  reactNativeRange?: string;
  packageManager?: 'npm' | 'yarn' | 'pnpm';
  /** Monorepo root holding the lockfile, when it is not the app folder. */
  workspaceRoot?: string;
  /** Absolute path of the lockfile that was read; undefined when none was found. */
  lockfile?: string;
  /** Installed versions of the direct dependencies, resolved from the lockfile. */
  installed: Record<string, string>;
  /** Declared direct dependencies: name -> range (dependencies and devDependencies). */
  declared: Record<string, string>;
  devOnly: string[];

  // Filled by runScan after the project files are read.
  latestReactNative?: Sourced<string>;
  dependencies?: DependencyInfo[];
  android?: AndroidConfig;
  ios?: IosConfig;
  patches?: PatchInfo[];
  apk?: ApkReport;
  templates?: NativeTemplates;
  /** Time of the scan (ISO), for date rules such as certificate expiry. Defaults to now. */
  now?: string;
}

export interface Report {
  meta: {
    tool: string;
    version: string;
    scannedAt: string;
    cwd: string;
    apk?: string;
    /** 'apk-only' when --apk was given outside a React Native project. */
    mode: 'project' | 'apk-only';
    reactNativeVersion?: string;
    reactNativeVersionSource?: ProjectContext['reactNativeVersionSource'];
    latestReactNative?: string;
    latestReactNativeSource?: string;
    upgradeHelperUrl?: string;
    packageManager?: ProjectContext['packageManager'];
    /** Lockfile read, relative to `cwd` (e.g. "package-lock.json" or "../../yarn.lock" in a monorepo). */
    lockfile?: string;
    offline: boolean;
  };
  summary: { blockers: number; warnings: number; info: number };
  findings: Finding[];
  dependencies: DependencyInfo[];
  android?: AndroidConfig;
  ios?: IosConfig;
  /** Your Android/iOS settings next to the React Native template values for your current and target version. */
  native: NativeComparison;
  patches: PatchInfo[];
  apk?: ApkReport;
  /** Present when an APK/AAB was scanned. */
  playStore?: PlayStoreVerdict;
}
