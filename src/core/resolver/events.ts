// Schedule/event extraction — POWER build only (off-store). CS_POWER_RESOLVER
//
// Turns an aggregator's schedule/landing page into a clean list of games, so the user can jump straight
// to the one they want instead of clicking through ad-laden interstitials. DOMAIN-AGNOSTIC by design:
// no site-specific selectors. It scores each link from a few orthogonal signals — a "Team A vs Team B"
// matchup in the link text, the URL slug, or the surrounding card; a sport/league keyword; a live/time
// cue — and extracts the title from whichever source has the matchup (text → slug → context → JSON-LD).
// That one rule covers streameast-style cards, crackstreams-style slugs, and table/grid schedules alike.
// The DOM scan that produces the input runs in the page via scripting; this is the pure, testable core
// (same shape as harvest.ts's rankMirrorCandidates).
import { safeHttpUrl } from '@/core/url-safety';
import { canonicalKey } from '@/core/detection';
import { NOISE } from '@/core/resolver/harvest';

export interface RawAnchor {
  href: string;
  text?: string;
  slug?: string;
  context?: string; // text of the nearest length-bounded enclosing card/row
}
export interface LdEvent {
  name: string;
  startDate?: string;
  url?: string;
}
export type EventStatus = 'live' | 'upcoming' | 'finished' | 'unknown';
export interface EventItem {
  url: string;
  title: string; // "Team A vs Team B"
  sport?: string;
  status: EventStatus;
  when?: string; // raw time/relative text for display
  score: number; // event-confidence (sort tiebreak + debug)
}
export interface EventsInput {
  anchors: RawAnchor[];
  jsonld?: LdEvent[];
  pageUrl: string;
}

// Matchup separator: " vs ", " v. ", " @ " (spaces required so we don't trip on "vs" inside a word).
const SEP = /\s(?:vs\.?|v\.|@)\s/i;
// A slug matchup: "lakers-vs-celtics", "germany-vs-curacao".
const SLUG_VS = /(?:^|[-_/])vs(?:[-_/])/i;
// Pictographic emojis + variation selectors (sport/status icons) — stripped from titles.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{27BF}\u{2B00}-\u{2BFF}️‍]/gu;
// Where the team name ends and metadata begins: separators, days, months, clock/am-pm, status, tz.
const STOP =
  /[·|,\n]|\b(?:sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}\s*(?:am|pm)\b|\b(?:live|finished|ended|final|today|tomorrow)\b|\bfrom\s+now\b|\b(?:ET|EST|EDT|PT|PST|PDT|CT|GMT|UTC|BST)\b/i;
const LEAGUE_LEAD = /^(?:mlb|nba|nfl|nhl|ncaa|ufc|mma|wwe|aew|epl|mls|atp|wta|pga|f1)\b[\s:–-]*/i;

// Sport/league badges. Keyword first; emoji as a fallback for icon-only schedules.
const SPORTS: [RegExp, string][] = [
  [/\b(mlb|baseball)\b/i, 'MLB'],
  [/\b(nba|basketball)\b/i, 'NBA'],
  [/\b(nfl|american football)\b/i, 'NFL'],
  [/\b(nhl|hockey)\b/i, 'NHL'],
  [/\b(ncaa|college)\b/i, 'NCAA'],
  [/\b(ufc|mma)\b/i, 'UFC/MMA'],
  [/\bbox(?:ing)?\b/i, 'Boxing'],
  [/\b(soccer|football|epl|laliga|la\s?liga|serie\s?a|bundesliga|ligue\s?1|uefa|fifa|mls|champions)\b/i, 'Soccer'],
  [/\b(tennis|atp|wta)\b/i, 'Tennis'],
  [/\b(f1|formula\s?1|motogp|nascar|racing|indycar)\b/i, 'Motorsport'],
  [/\b(wwe|aew|wrestl)/i, 'Wrestling'],
  [/\b(cricket|ipl)\b/i, 'Cricket'],
  [/\brugby\b/i, 'Rugby'],
  [/\b(golf|pga)\b/i, 'Golf'],
];
const EMOJI_SPORT: [string, string][] = [
  ['⚾', 'MLB'], ['🏀', 'NBA'], ['🏈', 'NFL'], ['🏒', 'NHL'], ['⚽', 'Soccer'],
  ['🥊', 'Boxing'], ['👊', 'Boxing'], ['🤼', 'Wrestling'], ['🎾', 'Tennis'],
  ['🏏', 'Cricket'], ['🏉', 'Rugby'], ['⛳', 'Golf'], ['🏎', 'Motorsport'], ['🏁', 'Motorsport'],
];

const FINISHED = /\b(finished|ended|final|full[-\s]?time|postponed|cancell?ed)\b/i;
// Deliberately NOT "now" — it trips on "2 hours from now" (which is upcoming, not live).
const LIVE = /\b(live|in\s?progress|streaming)\b/i;
// A readable "when" for upcoming games.
const WHEN =
  /(\b\d{1,2}:\d{2}\s?(?:am|pm)?(?:\s?(?:ET|EST|EDT|PT|PST|PDT|CT|GMT|UTC|BST))?)|(\b\d+\s*(?:hours?|hrs?|mins?|minutes?)\b(?:\s*from\s*now)?)|(\b(?:today|tomorrow)\b)/i;

const clean = (s: string): string => s.replace(/\s+/g, ' ').trim();
const noEmoji = (s: string): string => clean(s.replace(EMOJI, ' '));
const isTeamish = (s: string): boolean => /\p{L}/u.test(s) && s.length >= 2 && s.length <= 40 && s.split(' ').length <= 6;

/** Drop preceding metadata/league/punctuation and keep the trailing team name (left of "vs"). */
function leftTeam(raw: string): string {
  let t = noEmoji(raw);
  let last = 0;
  const re = new RegExp(STOP.source, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) last = m.index + m[0].length; // skip everything up to the last metadata token
  t = clean(t.slice(last)).replace(/^[^\p{L}\p{N}]+/u, '');
  t = t.replace(LEAGUE_LEAD, '');
  return clean(t.split(' ').slice(-6).join(' '));
}

/** Keep the leading team name, cut at the first metadata token (right of "vs"). */
function rightTeam(raw: string): string {
  const t = noEmoji(raw);
  const m = STOP.exec(t);
  const head = clean(m ? t.slice(0, m.index) : t).replace(/[^\p{L}\p{N})]+$/u, '');
  return clean(head.split(' ').slice(0, 6).join(' '));
}

/** Extract a "Team A vs Team B" title from a (possibly noisy) string, or null. */
export function matchup(s: string): string | null {
  const t = clean(s);
  const m = SEP.exec(t);
  if (!m) return null;
  const left = leftTeam(t.slice(0, m.index));
  const right = rightTeam(t.slice(m.index + m[0].length));
  if (!isTeamish(left) || !isTeamish(right)) return null;
  return `${left} vs ${right}`;
}

/** Derive a title from a URL slug like "lakers-vs-celtics-99" → "Lakers vs Celtics". */
export function titleFromSlug(slug: string): string | null {
  if (!SLUG_VS.test(slug)) return null;
  const words = slug
    .replace(/\.(html?|php|aspx?)$/i, '')
    .replace(/[-_]\d+$/, '') // trailing numeric id
    .replace(/^\d+[-_]/, '') // leading numeric id
    .replace(/^(?:event|watch|stream|live|game|match|fixture)[-_]/i, '') // common routing prefix
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => (/^v(?:s|\.)?$/i.test(w) ? 'vs' : w.charAt(0).toUpperCase() + w.slice(1)));
  const t = clean(words.join(' '));
  return matchup(t) ?? (isTeamish(t.replace(/\bvs\b/i, '').trim()) ? t : null);
}

export function sportOf(s: string): string | undefined {
  for (const [e, name] of EMOJI_SPORT) if (s.includes(e)) return name;
  for (const [re, name] of SPORTS) if (re.test(s)) return name;
  return undefined;
}

export function statusOf(s: string): { status: EventStatus; when?: string } {
  if (FINISHED.test(s)) return { status: 'finished' };
  if (LIVE.test(s)) return { status: 'live', when: 'LIVE' };
  const w = s.match(WHEN);
  if (w) return { status: 'upcoming', when: clean(w[0]).slice(0, 24) };
  return { status: 'unknown' };
}

const RANK: Record<EventStatus, number> = { live: 0, upcoming: 1, unknown: 2, finished: 3 };

/** Score + extract every link/JSON-LD item into a ranked, deduped game list. Pure. */
export function parseEvents(input: EventsInput, max = 50): EventItem[] {
  const pageKey = (() => {
    try {
      return canonicalKey(input.pageUrl);
    } catch {
      return '';
    }
  })();
  const byKey = new Map<string, EventItem>();

  const consider = (rawUrl: string, src: { text?: string; slug?: string; context?: string }, base = 0, forcedTitle?: string, forcedWhen?: string): void => {
    const safe = safeHttpUrl(rawUrl);
    if (!safe) return;
    const key = canonicalKey(safe);
    if (!key || key === pageKey) return;
    if (NOISE.test(safe) || NOISE.test(src.text ?? '')) return;

    // 1) Resolve the title + the source to read THIS game's own metadata from. Never a page-wide blob —
    // that cross-contaminates cards (one stray "Finished" would mark every game finished).
    let title = forcedTitle ?? null;
    let titleScore = base;
    let metaSrc = '';
    if (title) {
      titleScore += 3;
      metaSrc = `${forcedTitle ?? ''} ${src.text ?? ''} ${forcedWhen ?? ''}`;
    } else {
      const fromText = src.text ? matchup(src.text) : null;
      const fromSlug = src.slug ? titleFromSlug(src.slug) : null;
      const fromCtx = src.context ? matchup(src.context) : null;
      if (fromText) {
        title = fromText;
        titleScore += 3;
        metaSrc = src.text ?? '';
      } else if (fromSlug) {
        title = fromSlug;
        titleScore += 2;
        metaSrc = src.context || src.text || ''; // slug carries no status → read this row
      } else if (fromCtx) {
        title = fromCtx;
        titleScore += 2;
        metaSrc = src.context ?? '';
      } else if (src.text) {
        // No matchup — keep only a non-vs event (e.g. "RAW #1725", a UFC card); title from cleaned text.
        const cleaned = noEmoji(src.text).replace(LEAGUE_LEAD, '');
        const cut = STOP.exec(cleaned); // cut at the first metadata token (date/time/status)
        const t = clean(cut ? cleaned.slice(0, cut.index) : cleaned).slice(0, 60);
        if (t.replace(/\P{L}/gu, '').length >= 3) {
          title = t;
          metaSrc = src.text;
        }
      }
    }
    if (!title) return;

    // 2) Score + classify from this game's own metadata only.
    const sport = sportOf(metaSrc) ?? sportOf(title);
    const st = statusOf(metaSrc);
    const score = titleScore + (sport ? 1 : 0) + (st.status !== 'unknown' ? 1 : 0);
    if (score < 2) return; // confidence threshold

    const item: EventItem = { url: safe, title, sport, status: st.status, when: forcedWhen ?? st.when, score };
    const prev = byKey.get(key);
    if (!prev || item.score > prev.score) byKey.set(key, item);
  };

  for (const a of input.anchors) consider(a.href, { text: a.text, slug: a.slug ?? slugOf(a.href), context: a.context });
  for (const e of input.jsonld ?? []) {
    if (e.url) consider(e.url, { text: e.name }, 4, matchup(e.name) ?? clean(e.name).slice(0, 60), e.startDate);
  }

  // Dedupe by normalized title too (collapse a game's many per-mirror links into one row), keep best.
  const seen = new Set<string>();
  const out: EventItem[] = [];
  for (const it of [...byKey.values()].sort((a, b) => RANK[a.status] - RANK[b.status] || b.score - a.score)) {
    const tk = it.title.toLowerCase();
    if (seen.has(tk)) continue;
    seen.add(tk);
    out.push(it);
    if (out.length >= max) break;
  }
  return out;
}

function slugOf(href: string): string | undefined {
  try {
    const segs = new URL(href).pathname.split('/').filter(Boolean);
    for (let i = segs.length - 1; i >= 0; i--) if (/[a-z]/i.test(segs[i]!)) return segs[i];
    return segs[segs.length - 1];
  } catch {
    return undefined;
  }
}
