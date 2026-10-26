import { PLAY_POLICY } from '../rules/index.js';
import type { Finding, NativeLib, ProjectContext } from '../types.js';

/** 16 KB page-size findings from an APK/AAB scan, grouped per npm package so each fix appears once. */
export function checkApk(ctx: ProjectContext): Finding[] {
  const apk = ctx.apk;
  if (!apk) return [];
  const source = `APK scan (${apk.kind.toUpperCase()})`;

  const failing = apk.libs.filter((lib) => !lib.elfOk || lib.zipAligned === false);
  if (failing.length === 0) {
    // Count libraries, not their per-ABI copies, like the 16 KB summary in the report does.
    const checked = new Set(apk.libs.filter((lib) => lib.is64Bit).map((lib) => lib.name)).size;
    return [
      {
        id: 'apk-16kb-ok',
        severity: 'info',
        title:
          checked === 0
            ? 'No 64-bit native libraries found in the build'
            : checked === 1
              ? 'The only 64-bit native library is 16 KB page-size compatible'
              : `All ${checked} 64-bit native libraries are 16 KB page-size compatible`,
        source,
      },
    ];
  }

  const byPackage = new Map<string, NativeLib[]>();
  for (const lib of failing) {
    const key = lib.package ?? '';
    byPackage.set(key, [...(byPackage.get(key) ?? []), lib]);
  }

  return [...byPackage.entries()].map(([pkg, libs]): Finding => {
    const names = [...new Set(libs.map((l) => l.name))];
    const elf = libs.filter((l) => !l.elfOk);
    const zip = libs.filter((l) => l.zipAligned === false);
    const reasons = [
      elf.length > 0 ? `ELF segments aligned to ${formatAlign(elf)} instead of 16 KB` : '',
      zip.length > 0 ? 'stored uncompressed at an offset that is not 16 KB aligned in the APK' : '',
    ].filter(Boolean);
    return {
      id: `apk-16kb:${pkg || names[0]}`,
      severity: 'blocker',
      title: `${pkg || 'Unknown package'}: ${names.join(', ')} not 16 KB page-size compatible`,
      detail: `${reasons.join('; ')}. ABIs: ${[...new Set(libs.map((l) => l.abi))].join(', ')}. ${PLAY_POLICY.sixteenKbNote}`,
      package: pkg || undefined,
      fix: fixFor(pkg, elf.length > 0, zip.length > 0),
      source: pkg ? `${source}; package from ${libs[0].packageSource}` : source,
    };
  });
}

function formatAlign(libs: NativeLib[]): string {
  const aligns = [...new Set(libs.map((l) => (l.loadAlign === undefined ? 'unreadable' : `${l.loadAlign / 1024} KB`)))];
  return aligns.join(' / ');
}

function fixFor(pkg: string, elf: boolean, zip: boolean): string {
  const steps: string[] = [];
  if (elf) {
    steps.push(
      pkg === 'react-native'
        ? 'Upgrade React Native to 0.77 or newer.'
        : pkg
          ? `Upgrade ${pkg} to a release built with NDK r28+ (or linked with -Wl,-z,max-page-size=16384).`
          : 'Find which dependency ships this library and upgrade it to a 16 KB compatible release.',
    );
  }
  if (zip) steps.push(PLAY_POLICY.zipAlignFix);
  return steps.join(' ');
}
