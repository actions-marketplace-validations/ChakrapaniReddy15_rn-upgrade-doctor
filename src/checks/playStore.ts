import { PLAY_DOCS, PLAY_POLICY, SENSITIVE_PERMISSIONS } from '../rules/index.js';
import type { ApkManifest, ApkReport, Finding, PlayStoreVerdict, ProjectContext } from '../types.js';

/** Finding ids of this check start with "play-"; 16 KB results reuse the existing "apk-16kb:" findings. */
export const PLAY_ID_PREFIX = 'play-';

/**
 * Pre-upload checks of a built APK/AAB against Google Play requirements: target API level, 64-bit libraries,
 * debuggable builds, signing, exported components, sensitive permissions and cleartext traffic.
 */
export function checkPlayStore(ctx: ProjectContext): Finding[] {
  const apk = ctx.apk;
  if (!apk) return [];
  const findings: Finding[] = [];
  const manifest = apk.manifest?.available ? apk.manifest.manifest : undefined;
  const source = (part: string) => `APK ${part} (${apk.kind.toUpperCase()})`;

  if (apk.manifest && !apk.manifest.available) {
    findings.push({
      id: 'play-manifest-unavailable',
      severity: 'info',
      title: 'Manifest checks did not run',
      detail: `${apk.manifest.reason} Target API level, debuggable, exported components, permissions and cleartext were not checked.`,
      fix: apk.kind === 'aab' ? 'Run the scan on a release APK of the same build to include them.' : undefined,
      source: source('manifest'),
    });
  }

  if (manifest) findings.push(...manifestFindings(manifest, source('manifest')));
  findings.push(...nativeAbiFindings(apk));
  findings.push(...signingFindings(apk, manifest, ctx.now, source('signature')));

  if (apk.kind === 'apk') {
    findings.push({
      id: 'play-aab-required',
      severity: 'info',
      title: 'Google Play needs an Android App Bundle (AAB) for new apps; this APK check is a pre-upload check',
      fix: 'Upload the AAB of the same build (./gradlew bundleRelease).',
      source: source('scan'),
      docs: PLAY_DOCS.appBundle,
    });
  }
  return findings;
}

function manifestFindings(manifest: ApkManifest, source: string): Finding[] {
  const findings: Finding[] = [];
  const targetSdk = manifest.targetSdk;

  if (targetSdk !== undefined && targetSdk < PLAY_POLICY.minTargetSdk) {
    findings.push({
      id: 'play-target-sdk',
      severity: 'blocker',
      title: `targetSdkVersion ${targetSdk} is below ${PLAY_POLICY.minTargetSdk}, the minimum for new apps and updates on Google Play`,
      detail: PLAY_POLICY.minTargetSdkNote,
      fix: `Set targetSdkVersion to ${PLAY_POLICY.minTargetSdk} or higher and test the behaviour changes of each Android version in between.`,
      source,
      docs: PLAY_DOCS.targetSdk,
    });
  }

  if (manifest.debuggable === true) {
    findings.push({
      id: 'play-debuggable',
      severity: 'blocker',
      title: 'The app is debuggable (android:debuggable="true")',
      detail: 'Google Play rejects debuggable builds. This usually means a debug build was uploaded instead of a release build.',
      fix: 'Build the release variant (./gradlew assembleRelease or bundleRelease) and do not set android:debuggable in the manifest.',
      source,
      docs: PLAY_DOCS.debuggable,
    });
  }

  if (targetSdk !== undefined && targetSdk >= PLAY_POLICY.exportedRequiredFromTargetSdk) {
    const missing = manifest.components.filter((c) => c.type !== 'provider' && c.hasIntentFilter && c.exported === undefined);
    if (missing.length > 0) {
      const names = missing.map((c) => `${c.type} ${c.name}`);
      findings.push({
        id: 'play-exported',
        severity: 'blocker',
        title: `${missing.length} component${missing.length === 1 ? ' has' : 's have'} an intent filter but no android:exported`,
        detail:
          `Apps targeting Android 12+ cannot be installed when an activity, service or receiver with an intent filter does not set android:exported: ` +
          `${names.slice(0, 5).join(', ')}${names.length > 5 ? `, and ${names.length - 5} more` : ''}.`,
        fix: 'Set android:exported="true" for the launcher activity and components other apps must reach, "false" for everything else.',
        source,
        docs: PLAY_DOCS.exported,
      });
    }
  }

  for (const permission of manifest.permissions) {
    const rule = SENSITIVE_PERMISSIONS[permission];
    if (!rule) continue;
    const name = permission.replace('android.permission.', '');
    findings.push({
      id: `play-permission:${name}`,
      severity: 'warning',
      title: `${name} needs a permissions declaration in Play Console (${rule.policy})`,
      detail: 'Google Play only allows this permission for qualifying core functionality, declared in Play Console before review.',
      fix: 'Remove the permission if the app does not need it (also check what your libraries add), or fill in the declaration form.',
      source,
      docs: rule.docs,
    });
  }

  if (manifest.usesCleartextTraffic === true) {
    findings.push({
      id: 'play-cleartext',
      severity: 'warning',
      title: 'Cleartext HTTP is allowed for all domains (android:usesCleartextTraffic="true")',
      detail: 'Unencrypted traffic can be read or changed on the network. It is often left over from a debug setup.',
      fix: 'Remove usesCleartextTraffic, or allow cleartext only for specific domains with a network security config.',
      source,
      docs: PLAY_DOCS.cleartext,
    });
  }
  return findings;
}

function nativeAbiFindings(apk: ApkReport): Finding[] {
  if (apk.libs.length === 0 || apk.libs.some((l) => l.is64Bit)) return [];
  const abis = [...new Set(apk.libs.map((l) => l.abi))].join(', ');
  return [
    {
      id: 'play-64bit',
      severity: 'blocker',
      title: `Native libraries are only built for 32-bit ABIs (${abis})`,
      detail: 'Google Play requires apps with native code to include 64-bit versions (arm64-v8a, and x86_64 if you ship x86).',
      fix: 'Add arm64-v8a (and x86_64) to reactNativeArchitectures in android/gradle.properties or abiFilters in android/app/build.gradle.',
      source: `APK scan (${apk.kind.toUpperCase()})`,
      docs: PLAY_DOCS.sixtyFourBit,
    },
  ];
}

function signingFindings(apk: ApkReport, manifest: ApkManifest | undefined, now: string | undefined, source: string): Finding[] {
  const signing = apk.signing;
  if (!signing) return [];

  if (signing.unsigned) {
    return [
      {
        id: 'play-unsigned',
        severity: 'blocker',
        title: `The ${apk.kind.toUpperCase()} is not signed`,
        detail: 'Google Play only accepts uploads signed with your upload key.',
        fix: 'Configure a release signingConfig in android/app/build.gradle with your upload keystore, then build again.',
        source,
        docs: PLAY_DOCS.signing,
      },
    ];
  }

  const findings: Finding[] = [];
  if (signing.debugSigned) {
    findings.push({
      id: 'play-debug-signed',
      severity: 'blocker',
      title: 'Signed with the Android debug key (CN=Android Debug)',
      detail:
        'Google Play rejects apps signed with the debug key. The React Native template signs release builds with the debug key ' +
        'until you configure your own.',
      fix: 'Create an upload key and use it in the release signingConfig of android/app/build.gradle.',
      source,
      docs: PLAY_DOCS.signing,
    });
  }

  // An AAB only ever has v1 (JAR) signatures, so the v2 rule applies to APKs.
  const targetSdk = manifest?.targetSdk;
  if (apk.kind === 'apk' && signing.schemes.every((s) => s === 'v1') && targetSdk !== undefined && targetSdk >= PLAY_POLICY.v2RequiredFromTargetSdk) {
    findings.push({
      id: 'play-v1-only',
      severity: 'blocker',
      title: `Signed only with APK Signature Scheme v1, but targetSdkVersion is ${targetSdk}`,
      detail: 'Apps targeting Android 11+ that are signed only with v1 cannot be installed or updated on Android 11 and newer.',
      fix: 'Sign with v2 or newer as well (apksigner and the Android Gradle Plugin do this by default).',
      source,
      docs: PLAY_DOCS.v2Signing,
    });
  }

  const time = now ? Date.parse(now) : Date.now();
  for (const cert of signing.certificates.filter((c) => !c.debug)) {
    const validTo = Date.parse(cert.validTo);
    if (validTo < time) {
      findings.push({
        id: 'play-cert-expired',
        severity: 'blocker',
        title: `Signing certificate expired on ${cert.validTo.slice(0, 10)} (${cert.subject})`,
        fix: 'Sign with a valid key. If this is your app signing key, contact Google Play support about key upgrade options.',
        source,
        docs: PLAY_DOCS.signing,
      });
    } else if (validTo < Date.parse(PLAY_POLICY.certificateValidAfter)) {
      findings.push({
        id: 'play-cert-validity',
        severity: 'blocker',
        title: `Signing certificate is valid only until ${cert.validTo.slice(0, 10)}; Google Play needs validity after 22 Oct 2033 (${cert.subject})`,
        fix: 'Create a key valid for 25 years or more and use it as your upload key.',
        source,
        docs: PLAY_DOCS.signing,
      });
    }
  }
  return findings;
}

/** Findings that decide whether the build can go to Google Play: the play-* rules and the 16 KB blockers. */
export function isPlayFinding(finding: Finding): boolean {
  return finding.id.startsWith(PLAY_ID_PREFIX) || finding.id.startsWith('apk-16kb:');
}

/** The "Play Store ready?" verdict from the ranked findings of a scan with an APK/AAB. */
export function playStoreVerdict(findings: Finding[], apk: ApkReport): PlayStoreVerdict {
  const relevant = findings.filter(isPlayFinding);
  const manifest = apk.manifest?.available ? apk.manifest.manifest : undefined;
  const blockers = relevant.filter((f) => f.severity === 'blocker').length;
  return {
    ready: blockers === 0,
    blockers,
    warnings: relevant.filter((f) => f.severity === 'warning').length,
    findingIds: relevant.map((f) => f.id),
    ...(manifest
      ? {
          app: {
            package: manifest.package,
            versionName: manifest.versionName,
            versionCode: manifest.versionCode,
            minSdk: manifest.minSdk,
            targetSdk: manifest.targetSdk,
          },
        }
      : {}),
    ...(apk.signing && !apk.signing.unsigned
      ? {
          signing: {
            schemes: apk.signing.schemes,
            certificates: apk.signing.certificates.map((c) => ({ subject: c.subject, sha256: c.sha256, validTo: c.validTo })),
          },
        }
      : {}),
  };
}
