import type { Finding, PlayStoreVerdict, Report } from '../types.js';

/** What the "Play Store ready?" section shows, shared by the terminal, Markdown and HTML renderers. */
export interface PlayStoreSection {
  verdict: PlayStoreVerdict;
  /** "✅ Ready for Play Store" or "❌ 2 blockers, ⚠️ 1 warning". */
  heading: string;
  /** e.g. "com.demo.shop 2.1.0 (42) · minSdk 24 · targetSdk 36". */
  app?: string;
  /** e.g. "v2, v3 · CN=Demo Release, O=Demo, C=US · valid until 2060-12-23". */
  signedWith: string[];
  /** SHA-256 fingerprints of the signer certificates, to compare with Play Console. */
  fingerprints: string[];
  /** Blockers and warnings to fix, in ranked order. */
  issues: Finding[];
  /** Info items (AAB note, manifest checks skipped). */
  notes: Finding[];
}

export const PLAY_CONSOLE_HINT = 'compare with Play Console > Setup > App signing > Upload key certificate';

export function playStoreSection(report: Report): PlayStoreSection | undefined {
  const verdict = report.playStore;
  if (!verdict) return undefined;
  const findings = verdict.findingIds
    .map((id) => report.findings.find((f) => f.id === id))
    .filter((f): f is Finding => f !== undefined);

  return {
    verdict,
    heading: headingText(verdict),
    app: appText(verdict),
    signedWith: (verdict.signing?.certificates ?? []).map(
      (c) => `${verdict.signing!.schemes.join(', ')} · ${c.subject} · valid until ${c.validTo.slice(0, 10)}`,
    ),
    fingerprints: (verdict.signing?.certificates ?? []).map((c) => c.sha256),
    issues: findings.filter((f) => f.severity !== 'info'),
    notes: findings.filter((f) => f.severity === 'info'),
  };
}

function headingText(v: PlayStoreVerdict): string {
  const warnings = v.warnings > 0 ? `⚠️ ${v.warnings} warning${v.warnings === 1 ? '' : 's'}` : '';
  if (v.ready) return warnings ? `✅ Ready for Play Store (${warnings} to review)` : '✅ Ready for Play Store';
  const blockers = `❌ ${v.blockers} blocker${v.blockers === 1 ? '' : 's'}`;
  return warnings ? `${blockers}, ${warnings}` : blockers;
}

function appText(v: PlayStoreVerdict): string | undefined {
  const app = v.app;
  if (!app) return undefined;
  const version = app.versionName ? `${app.versionName}${app.versionCode !== undefined ? ` (${app.versionCode})` : ''}` : undefined;
  return [
    [app.package, version].filter(Boolean).join(' '),
    app.minSdk !== undefined ? `minSdk ${app.minSdk}` : undefined,
    app.targetSdk !== undefined ? `targetSdk ${app.targetSdk}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}
