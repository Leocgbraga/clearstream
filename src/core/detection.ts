// Pure detection/dedupe/ranking helpers. No chrome/DOM imports → unit-testable.
// See docs/research/06-capture-engine.md (§2, §4) and docs/architecture.md (§5.2).
import type { CapturedStream, ManifestKind } from './types';

export const MANIFEST_RE = /\.(m3u8|mpd)(\?|#|$)/i;

export function isManifestUrl(url: string): boolean {
  return MANIFEST_RE.test(url);
}

/** Canonical dedupe key: lowercased host + path, common cache-busters stripped. */
export function canonicalKey(url: string): string {
  try {
    const u = new URL(url);
    for (const p of ['_', 't', 'cb', 'cache', 'rnd']) u.searchParams.delete(p);
    return `${u.host}${u.pathname}?${u.searchParams.toString()}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/** URL-only hint. Real master/media split needs the manifest body (Phase 2). */
export function classifyByUrl(url: string): ManifestKind {
  if (/(master|playlist|index|chunklist|manifest)/i.test(url)) return 'master';
  return 'unknown';
}

const AD_HOST_RE = /(doubleclick|googlesyndication|imasdk|adservice|moatads|adsystem|\bads?\b)/i;

export function scoreStream(s: CapturedStream): number {
  let score = 0;
  if (s.kind === 'master') score += 100;
  else if (s.kind === 'media') score += 40;
  if (AD_HOST_RE.test(s.manifestUrl)) score -= 100;
  if (s.replayHeaders?.referer) score += 5;
  return score;
}

/** Dedupe by canonical key (keep newest), then rank best-first. */
export function dedupeAndRank(streams: CapturedStream[]): CapturedStream[] {
  const byKey = new Map<string, CapturedStream>();
  for (const s of streams) {
    const existing = byKey.get(s.key);
    if (!existing || s.createdAt > existing.createdAt) byKey.set(s.key, s);
  }
  return [...byKey.values()]
    .map((s) => ({ ...s, score: scoreStream(s) }))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.createdAt - a.createdAt);
}
