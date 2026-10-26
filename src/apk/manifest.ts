import type { ApkManifest, ManifestComponent, ManifestResult } from '../types.js';
import { attribute, AxmlError, isAxml, parseAxml, type AxmlElement, type AxmlValue } from './axml.js';
import { readZipEntry } from './zip.js';

/** Android framework attribute resource IDs (android.R.attr), stable across Android versions. */
const ATTR = {
  name: 0x01010003,
  debuggable: 0x0101000f,
  exported: 0x01010010,
  minSdkVersion: 0x0101020c,
  versionCode: 0x0101021b,
  versionName: 0x0101021c,
  targetSdkVersion: 0x01010270,
  usesCleartextTraffic: 0x010104ec,
  networkSecurityConfig: 0x01010527,
} as const;

const COMPONENT_TYPES: ReadonlyArray<ManifestComponent['type']> = ['activity', 'activity-alias', 'service', 'receiver', 'provider'];
const PERMISSION_TAGS = ['uses-permission', 'uses-permission-sdk-23'];

/** The APK's AndroidManifest.xml, parsed; or why it could not be read. */
export async function readManifest(file: string, kind: 'apk' | 'aab'): Promise<ManifestResult> {
  if (kind === 'aab') {
    return { available: false, reason: 'Manifest checks need an APK: an AAB stores its manifest in protobuf format.' };
  }
  let data: Buffer | undefined;
  try {
    data = await readZipEntry(file, 'AndroidManifest.xml');
  } catch (err) {
    return { available: false, reason: `Could not read AndroidManifest.xml: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!data) return { available: false, reason: 'AndroidManifest.xml not found in the APK.' };
  if (!isAxml(data)) return { available: false, reason: 'AndroidManifest.xml is not a compiled (binary) manifest.' };
  try {
    return { available: true, manifest: extractManifest(parseAxml(data)) };
  } catch (err) {
    const message = err instanceof AxmlError ? err.message : String(err);
    return { available: false, reason: `AndroidManifest.xml could not be parsed: ${message}` };
  }
}

/** The fields the Play Store checks need, from a parsed manifest tree. */
export function extractManifest(root: AxmlElement): ApkManifest {
  if (root.name !== 'manifest') throw new AxmlError(`root element is <${root.name}>, not <manifest>`);
  const pkg = asString(attribute(root, 'package'));
  const usesSdk = root.children.find((c) => c.name === 'uses-sdk');
  const application = root.children.find((c) => c.name === 'application');

  const components = (application?.children ?? [])
    .filter((c) => (COMPONENT_TYPES as readonly string[]).includes(c.name))
    .map(
      (c): ManifestComponent => ({
        type: c.name as ManifestComponent['type'],
        name: fullName(asString(attribute(c, 'name', ATTR.name)) ?? '', pkg),
        exported: asBool(attribute(c, 'exported', ATTR.exported)),
        hasIntentFilter: c.children.some((child) => child.name === 'intent-filter'),
      }),
    );

  return {
    package: pkg,
    versionCode: asInt(attribute(root, 'versionCode', ATTR.versionCode)),
    versionName: asString(attribute(root, 'versionName', ATTR.versionName)),
    minSdk: usesSdk ? asInt(attribute(usesSdk, 'minSdkVersion', ATTR.minSdkVersion)) : undefined,
    targetSdk: usesSdk ? asInt(attribute(usesSdk, 'targetSdkVersion', ATTR.targetSdkVersion)) : undefined,
    debuggable: application ? asBool(attribute(application, 'debuggable', ATTR.debuggable)) : undefined,
    usesCleartextTraffic: application ? asBool(attribute(application, 'usesCleartextTraffic', ATTR.usesCleartextTraffic)) : undefined,
    networkSecurityConfig: application ? attribute(application, 'networkSecurityConfig', ATTR.networkSecurityConfig) !== undefined : false,
    permissions: [
      ...new Set(
        root.children
          .filter((c) => PERMISSION_TAGS.includes(c.name))
          .map((c) => asString(attribute(c, 'name', ATTR.name)))
          .filter((name): name is string => Boolean(name)),
      ),
    ],
    components,
  };
}

function asString(value: AxmlValue | undefined): string | undefined {
  return value?.type === 'string' ? value.value : undefined;
}

/** Numbers can be stored as ints or, in some builds, as strings ("34"). */
function asInt(value: AxmlValue | undefined): number | undefined {
  if (value?.type === 'int') return value.value;
  if (value?.type === 'string' && /^\d+$/.test(value.value)) return Number(value.value);
  return undefined;
}

function asBool(value: AxmlValue | undefined): boolean | undefined {
  if (value?.type === 'bool') return value.value;
  if (value?.type === 'string' && (value.value === 'true' || value.value === 'false')) return value.value === 'true';
  return undefined;
}

/** ".MainActivity" -> "com.example.app.MainActivity". */
function fullName(name: string, pkg: string | undefined): string {
  return name.startsWith('.') && pkg ? `${pkg}${name}` : name;
}
