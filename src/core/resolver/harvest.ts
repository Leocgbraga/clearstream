// Mirror/embed candidate harvesting — POWER build only (off-store). CS_POWER_RESOLVER
//
// Pure ranking of the links + iframes a page exposes, picking the URLs most likely to lead to a stream
// (the "Link 1 / HD / SD / Server 2" lists + embed iframes on an event page the user opened). The DOM
// scan that produces the input runs in the page via activeTab+scripting; this is the pure, testable part.
import { safeHttpUrl } from '@/core/url-safety';

export interface RawLink {
  href: string;
  text?: string;
}
export interface HarvestInput {
  links: RawLink[];
  iframes: string[];
  pageUrl: string;
}

// A path segment that looks like an embed/player route.
const EMBED_PATH = /\/(embed|player|stream|watch|live|iframe|video|go|e|v)\b/i;
// Link text that reads like a stream mirror.
const STREAM_TEXT = /\b(link|mirror|server|stream|watch|player|hd|sd|sports?|live|channel|source)\b/i;
const QUALITY_TEXT = /\b(hd|fhd|uhd|4k|1080|720)\b/i;
// Obvious non-stream chrome to drop. Exported so the event lister (events.ts) shares one noise list.
export const NOISE = /\b(facebook|twitter|telegram|discord|reddit|instagram|whatsapp|youtube|login|sign[\s-]?up|register|donate|dmca|contact|privacy|terms|about|home)\b/i;

/** Rank + dedupe + cap the candidate URLs most likely to resolve to a stream. Pure. */
export function rankMirrorCandidates(input: HarvestInput, max = 8): string[] {
  let pageHost = '';
  try {
    pageHost = new URL(input.pageUrl).host;
  } catch {
    /* pageUrl not a URL */
  }
  const scored = new Map<string, number>();
  const bump = (raw: string, score: number): void => {
    const safe = safeHttpUrl(raw); // http(s) only
    if (!safe) return;
    let url: URL;
    try {
      url = new URL(safe);
    } catch {
      return;
    }
    const key = safe.split('#')[0]!;
    if (key === input.pageUrl.split('#')[0]) return; // skip the page itself
    scored.set(key, Math.max(scored.get(key) ?? 0, score + (url.host !== pageHost ? 5 : 0)));
  };

  for (const src of input.iframes) bump(src, 100); // an embed iframe is the strongest signal
  for (const { href, text } of input.links) {
    if (!href) continue;
    const t = text ?? '';
    if (NOISE.test(href) || NOISE.test(t)) continue;
    let s = 0;
    if (EMBED_PATH.test(href)) s += 50;
    if (STREAM_TEXT.test(t)) s += 30;
    if (QUALITY_TEXT.test(t)) s += 10;
    if (s > 0) bump(href, s);
  }

  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([url]) => url);
}
