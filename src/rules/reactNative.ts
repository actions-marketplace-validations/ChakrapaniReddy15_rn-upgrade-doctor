/**
 * React Native and store-policy rules. Data only; checks read it from here.
 * Sources: React Native release blog posts and changelogs, Android developer docs, Google Play policy pages.
 * Bump RULES_AS_OF whenever a value is reviewed.
 */
export const RULES_AS_OF = '2026-10';

/** New Architecture is on by default from this version. */
export const NEW_ARCH_DEFAULT_SINCE = '0.76.0';
/** From this version the legacy architecture can no longer be turned on: every native library must support the New Architecture. */
export const NEW_ARCH_ONLY_SINCE = '0.82.0';
/** First React Native release whose own native libraries are built for 16 KB page sizes. */
export const SIXTEEN_KB_SINCE = '0.77.0';

/**
 * Fallback minimum platform versions, used only when the React Native template (src/registry/template.ts) is not
 * available, e.g. offline without a cache. Newest first.
 */
export const PLATFORM_MINIMUMS: Array<{ since: string; minSdk: number; minIos: string }> = [
  { since: '0.76.0', minSdk: 24, minIos: '15.1' },
  { since: '0.74.0', minSdk: 23, minIos: '13.4' },
  { since: '0.73.0', minSdk: 21, minIos: '13.4' },
];


export function upgradeHelperUrl(from: string, to: string): string {
  return `https://react-native-community.github.io/upgrade-helper/?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
}
