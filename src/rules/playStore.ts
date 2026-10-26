/**
 * Google Play rules (phone and tablet apps). Data only; src/checks/playStore.ts reads it.
 * Checked 2026-10-26 against the linked developer.android.com and Play Console Help pages.
 * Play raises the target API level every August, so re-check this file yearly.
 */
export const PLAY_RULES_AS_OF = '2026-10-26';

export const PLAY_POLICY = {
  /** Lowest targetSdk Google Play accepts for new apps and app updates. */
  minTargetSdk: 36,
  minTargetSdkSince: '31 Aug 2026',
  minTargetSdkExtensionUntil: '1 Nov 2026',
  minTargetSdkNote:
    'Since 31 Aug 2026, Google Play requires new apps and app updates to target API 36 (Android 16) or higher ' +
    '(an extension to 1 Nov 2026 can be requested). Existing apps below API 35 are hidden from new users on newer Android versions.',
  /** One-line form for report headings. */
  sixteenKbShort: 'from 1 Feb 2027, Google Play blocks app updates without 16 KB support',
  /** The fix when uncompressed libraries are not 16 KB aligned in the APK: one build setting, not a per-library fix. */
  zipAlignFix:
    'Build with Android Gradle Plugin 8.5.1 or newer; if you align or sign the APK yourself, run `zipalign -P 16` before `apksigner`.',
  sixteenKbNote:
    'Google Play requires apps targeting Android 15+ to support 16 KB memory page sizes on 64-bit devices; ' +
    'from 1 Feb 2027, app updates that do not cannot be released.',
  /** "The key you use to sign your app must have a validity period ending after 22 October 2033." */
  certificateValidAfter: '2033-10-22T00:00:00.000Z',
  /** Apps targeting Android 11+ that are signed only with v1 cannot be installed or updated on Android 11 devices. */
  v2RequiredFromTargetSdk: 30,
  /** Apps targeting Android 12+ must set android:exported on activities, services and receivers with intent filters. */
  exportedRequiredFromTargetSdk: 31,
};

export const PLAY_DOCS = {
  targetSdk: 'https://developer.android.com/google/play/requirements/target-sdk',
  sixteenKb: 'https://developer.android.com/guide/practices/page-sizes',
  sixtyFourBit: 'https://developer.android.com/google/play/requirements/64-bit',
  debuggable: 'https://developer.android.com/guide/topics/manifest/application-element',
  signing: 'https://developer.android.com/studio/publish/app-signing',
  v2Signing: 'https://developer.android.com/about/versions/11/behavior-changes-11',
  exported: 'https://developer.android.com/about/versions/12/behavior-changes-12',
  cleartext: 'https://developer.android.com/privacy-and-security/security-config',
  appBundle: 'https://developer.android.com/guide/app-bundle',
};

/** Permissions Google Play only allows with a declaration in Play Console (and a qualifying core use). */
export const SENSITIVE_PERMISSIONS: Record<string, { policy: string; docs: string }> = Object.fromEntries(
  (
    [
      [['READ_SMS', 'RECEIVE_SMS', 'SEND_SMS', 'READ_CALL_LOG', 'WRITE_CALL_LOG'], 'SMS and Call Log permissions', 'https://support.google.com/googleplay/android-developer/answer/10208820'],
      [['ACCESS_BACKGROUND_LOCATION'], 'Location in the background', 'https://support.google.com/googleplay/android-developer/answer/9799150'],
      [['MANAGE_EXTERNAL_STORAGE'], 'All files access', 'https://support.google.com/googleplay/android-developer/answer/10467955'],
      [['QUERY_ALL_PACKAGES'], 'Broad package (app) visibility', 'https://support.google.com/googleplay/android-developer/answer/10158779'],
      [['REQUEST_INSTALL_PACKAGES'], 'Request install packages', 'https://support.google.com/googleplay/android-developer/answer/12085295'],
    ] as const
  ).flatMap(([names, policy, docs]) => names.map((name) => [`android.permission.${name}`, { policy, docs }])),
);
