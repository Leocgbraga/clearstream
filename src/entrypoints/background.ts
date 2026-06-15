// ClearStream background — capture engine (Phase 1) + header-injection orchestration (Phase 3).
//
// Detection (hybrid, decision D6):
//   • Click-to-detect (default): popup sends DETECT → scan the active tab via activeTab + scripting
//     (Performance API + DOM, all frames), capturing each frame's URL as the referer. No broad perms.
//   • Passive (optional): top-level webRequest observers fire only for hosts the user granted via the
//     "auto-detect on all sites" toggle → badge + capture request headers (incl. Referer/Cookie).
//
// Playback (Phase 3): popup → OPEN_PLAYER stashes the chosen streams keyed by the new player tab id
// and opens player.html. The player then calls GET_PLAYBACK, which installs a tab+host-scoped header
// rule (DNR on Chrome / blocking webRequest on Firefox) BEFORE returning — so headers are in place
// before hls.js makes its first request (race-free). See docs/research/{06,07,08}.
import { browser } from 'wxt/browser';
import type { CapturedStream, ReplayHeaders } from '@/core/types';
import { canonicalKey, classifyByUrl, dedupeAndRank, isManifestUrl } from '@/core/detection';
import { addStreams, clearTab, getStreams } from '@/core/storage';
import type { ErrorResponse, EventsDebugResponse, EventsResponse, Message, OkResponse, PlaybackResponse, ResolveProgress, StreamsResponse } from '@/core/messages';
import { parseEvents } from '@/core/resolver/events';
import type { EventItem, LdEvent, RawAnchor } from '@/core/resolver/events';
import { createHeaderInjector } from '@/core/header-injector';
import { safeHttpUrl } from '@/core/url-safety';
import { recallWorkingHeaders, rememberWorkingHeaders } from '@/core/prefs';
import { dlog } from '@/core/debug';
import { POWER } from '@/core/power';
import { resolveInTab, injectNeutralizer, type AwaitCapture } from '@/core/resolver/resolve-tab';
import { rankMirrorCandidates } from '@/core/resolver/harvest';
import { deriveMasterCandidates, isMasterPlaylist } from '@/core/resolver/master-probe';

const injector = createHeaderInjector();
const playbackKey = (tabId: number): string => `playback:${tabId}`;
const PLAYER_URL = browser.runtime.getURL('/player.html');

async function getPlayback(tabId: number): Promise<CapturedStream[]> {
  const key = playbackKey(tabId);
  const got = await browser.storage.session.get(key);
  return (got[key] as CapturedStream[] | undefined) ?? [];
}

/** Injected into each frame of the active tab (activeTab grant). Returns the manifest URLs already
 *  loaded (Performance API) or in the DOM, each paired with that frame's URL (used as referer). */
function scanPage(): Array<{ u: string; ref: string }> {
  const found = new Map<string, string>();
  const re = /\.m3u8(\?|#|$)/i; // HLS only (see MANIFEST_RE) — hls.js can't play DASH
  const ref = location.href;
  try {
    for (const e of performance.getEntriesByType('resource')) if (re.test(e.name)) found.set(e.name, ref);
  } catch {
    /* ignore */
  }
  try {
    document.querySelectorAll('video,source').forEach((el) => {
      const m = el as HTMLMediaElement;
      const s = m.src || m.currentSrc || el.getAttribute('src') || '';
      if (s && re.test(s)) found.set(s, ref);
    });
  } catch {
    /* ignore */
  }
  return [...found].map(([u, r]) => ({ u, ref: r }));
}

function toStream(
  url: string,
  tabId: number,
  frameId: number,
  pageUrl: string,
  headers?: ReplayHeaders,
  source?: CapturedStream['source'],
): CapturedStream {
  return {
    key: canonicalKey(url),
    manifestUrl: url,
    tabId,
    frameId,
    pageUrl,
    replayHeaders: headers ?? {},
    kind: classifyByUrl(url),
    source,
    createdAt: Date.now(),
  };
}

/** Best available headers to replay: captured ones, else a referer derived from the page URL. */
function effectiveHeaders(stream: CapturedStream): ReplayHeaders {
  const h: ReplayHeaders = { ...stream.replayHeaders };
  if (!h.referer && stream.pageUrl) {
    try {
      h.referer = new URL(stream.pageUrl).href; // full frame URL — many CDNs check the path, not just origin
    } catch {
      /* pageUrl not a URL */
    }
  }
  return h;
}

/** Unique CDN hostnames across a mirror list — the set header injection is scoped to. */
function hostsOf(streams: CapturedStream[]): string[] {
  const set = new Set<string>();
  for (const s of streams) {
    try {
      set.add(new URL(s.manifestUrl).hostname);
    } catch {
      /* skip */
    }
  }
  return [...set];
}

/** True only for messages from our own extension pages (popup/player). */
function fromExtensionPage(sender: { url?: string }): boolean {
  return typeof sender.url === 'string' && sender.url.startsWith(browser.runtime.getURL(''));
}

// --- Passive detection (optional; lit only when the user grants host access) ---
// Capture the real request headers (Referer/Cookie/UA) the host page sent for the manifest, so a
// locked CDN keeps serving when we replay them. onSendHeaders is observe-only (no 'blocking'); on
// Chrome the header VALUES require the 'extraHeaders' spec.
type WebRequestHeader = { name: string; value?: string };
function mapHeaders(reqHeaders: WebRequestHeader[] | undefined): ReplayHeaders {
  const h: ReplayHeaders = {};
  for (const { name, value } of reqHeaders ?? []) {
    const n = name.toLowerCase();
    if (n === 'referer') h.referer = value;
    else if (n === 'cookie') h.cookie = value;
    else if (n === 'user-agent') h.userAgent = value;
  }
  return h;
}

const onSendHeaders = (d: {
  tabId: number;
  url: string;
  frameId: number;
  requestHeaders?: WebRequestHeader[];
  initiator?: string;
  documentUrl?: string;
}): void => {
  if (d.tabId < 0 || !isManifestUrl(d.url)) return;
  const headers = mapHeaders(d.requestHeaders);
  const pageUrl = headers.referer ?? d.initiator ?? d.documentUrl ?? '';
  void onDetected(d.tabId, [toStream(d.url, d.tabId, d.frameId, pageUrl, headers, 'passive')]);
};

let passiveAttached = false;
/** (Re)attach the passive observer. A webRequest listener added BEFORE a runtime host grant won't
 *  retroactively match the newly-granted hosts on Chrome — so remove + re-add on every grant change. */
function rearmPassive(): void {
  const ev = browser.webRequest.onSendHeaders;
  type Add = typeof ev.addListener;
  if (passiveAttached) {
    ev.removeListener(onSendHeaders as Parameters<typeof ev.removeListener>[0]);
    passiveAttached = false;
  }
  const extra = (import.meta.env.FIREFOX ? ['requestHeaders'] : ['requestHeaders', 'extraHeaders']) as Parameters<Add>[2];
  ev.addListener(
    onSendHeaders as Parameters<Add>[0],
    { urls: ['<all_urls>'], types: ['xmlhttprequest', 'media', 'other'] } as Parameters<Add>[1],
    extra,
  );
  passiveAttached = true;
}

// Deep-capture content scripts (Chromium MAIN-world fetch/XHR hook + ISOLATED relay). Runtime-
// registered ONLY while the user holds all-sites access (so they add no install warning) and
// unregistered when revoked. Firefox doesn't support MAIN-world content scripts → no-op there.
async function syncDeepCapture(): Promise<void> {
  if (import.meta.env.FIREFOX) return;
  const sc = browser.scripting as typeof browser.scripting & {
    getRegisteredContentScripts?: (f?: { ids?: string[] }) => Promise<Array<{ id: string }>>;
    registerContentScripts?: (s: unknown[]) => Promise<void>;
    unregisterContentScripts?: (f: { ids: string[] }) => Promise<void>;
  };
  if (!sc.registerContentScripts) return;
  const ids = ['cs-deep-relay', 'cs-deep-main'];
  let granted = false;
  try {
    granted = await browser.permissions.contains({ origins: ['<all_urls>'] });
  } catch {
    /* */
  }
  try {
    const existing = (await sc.getRegisteredContentScripts?.({ ids })) ?? [];
    if (existing.length) await sc.unregisterContentScripts?.({ ids });
  } catch {
    /* */
  }
  if (!granted) return;
  try {
    await sc.registerContentScripts?.([
      // matchOriginAsFallback extends capture into opaque-origin frames (srcdoc / about:blank / data:)
      // that hostile pages use to bury the real player — plain allFrames doesn't reach those.
      { id: 'cs-deep-relay', js: ['content-scripts/deep-relay.js'], matches: ['<all_urls>'], runAt: 'document_start', allFrames: true, matchOriginAsFallback: true },
      { id: 'cs-deep-main', js: ['content-scripts/deep-main.js'], matches: ['<all_urls>'], runAt: 'document_start', allFrames: true, world: 'MAIN', matchOriginAsFallback: true },
    ]);
  } catch {
    /* registration unsupported / races a concurrent sync */
  }
}

async function setBadge(tabId: number, count: number): Promise<void> {
  try {
    await browser.action.setBadgeText({ tabId, text: count ? String(count) : '' });
    await browser.action.setBadgeBackgroundColor({ color: '#14b8a6' });
  } catch {
    /* tab may be gone */
  }
}

// --- Multi-mirror resolver (POWER build only; CS_POWER_RESOLVER) ---
// Render each embed/mirror URL in a hidden background tab and let the existing deep-capture observe the
// .m3u8 it loads. The waiter map below is fed by onDetected. All of this folds away in store builds.
const resolverWaiters = new Map<
  number,
  { got: CapturedStream[]; settle: (s: CapturedStream[]) => void; t?: ReturnType<typeof setTimeout> }
>();

function finishResolver(tabId: number): void {
  const e = resolverWaiters.get(tabId);
  if (!e) return;
  resolverWaiters.delete(tabId);
  if (e.t) clearTimeout(e.t);
  e.settle(e.got);
}

const awaitCapture: AwaitCapture = (tabId, timeoutMs) =>
  new Promise<CapturedStream[]>((settle) => {
    const entry: { got: CapturedStream[]; settle: (s: CapturedStream[]) => void; t?: ReturnType<typeof setTimeout> } = {
      got: [],
      settle,
    };
    entry.t = setTimeout(() => finishResolver(tabId), timeoutMs); // no capture in time → settle empty
    resolverWaiters.set(tabId, entry);
  });

const resolveKey = (tabId: number): string => `resolve:${tabId}`;
function reportResolve(tabId: number | undefined, p: ResolveProgress): void {
  if (tabId != null) void browser.storage.session.set({ [resolveKey(tabId)]: p });
}

/** Resolve a list of embed/mirror URLs → a deduped, ranked stream list (bounded concurrency). When a
 *  tabId is given, live progress is written to storage.session for the popup to subscribe to. */
async function resolveMirrors(urls: string[], tabId?: number): Promise<CapturedStream[]> {
  const MAX = 8;
  const POOL = 3;
  const list = urls.slice(0, MAX);
  if (urls.length > MAX) dlog('resolver: capped', urls.length, '→', MAX, 'mirrors');
  const all: CapturedStream[] = [];
  let i = 0;
  let done = 0;
  reportResolve(tabId, { phase: 'resolve', done, total: list.length, found: 0 });
  const worker = async (): Promise<void> => {
    while (i < list.length) {
      const url = list[i++]!;
      const streams = await resolveInTab(url, awaitCapture);
      dlog('resolver:', url, '→', streams.length, 'stream(s)');
      all.push(...streams);
      done++;
      reportResolve(tabId, { phase: 'resolve', done, total: list.length, found: all.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(POOL, list.length) || 1 }, worker));
  const result = await probeMaster(dedupeAndRank(all));
  reportResolve(tabId, { phase: 'done', done: list.length, total: list.length, found: result.length });
  return result;
}

// Harvest the page's mirror/embed candidates: DOM scan via scripting (all frames) → pure ranking.
// Catches both <a href> AND clickable non-anchors — aggregators render the "Watch" button that hops
// to the real player page (e.g. an event page → istreameast.cx) as an onclick/data-* <div>/<button>
// to fire popunders + dodge scrapers, exactly like the schedule tiles (see scanForEvents). Missing
// those left resolveEvent one layer short of the stream.
function scanForMirrors(): { links: { href: string; text: string }[]; iframes: string[] } {
  const seen = new Set<string>();
  const links: { href: string; text: string }[] = [];
  const add = (raw: string, el: Element): void => {
    let abs = '';
    try {
      abs = new URL(raw, location.href).href; // resolve relative onclick paths against the page
    } catch {
      return;
    }
    if (!/^https?:/i.test(abs) || seen.has(abs)) return;
    seen.add(abs);
    const text = ((el as HTMLElement).innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    links.push({ href: abs, text });
  };
  for (const a of [...document.querySelectorAll('a[href]')].slice(0, 800)) add((a as HTMLAnchorElement).href, a);
  for (const el of [...document.querySelectorAll('[data-href],[data-url],[data-link],[onclick]')].slice(0, 800)) {
    let href = el.getAttribute('data-href') || el.getAttribute('data-url') || el.getAttribute('data-link') || '';
    if (!href) {
      const m = (el.getAttribute('onclick') || '').match(/['"`]((?:https?:\/\/|\/)[^'"`]+)['"`]/);
      if (m) href = m[1]!;
    }
    if (href) add(href, el);
  }
  const iframes = [...document.querySelectorAll('iframe[src]')].map((f) => (f as HTMLIFrameElement).src);
  return { links, iframes };
}

async function harvestTab(tabId: number): Promise<string[]> {
  try {
    const results = await browser.scripting.executeScript({ target: { tabId, allFrames: true }, func: scanForMirrors });
    const links: { href: string; text: string }[] = [];
    const iframes: string[] = [];
    for (const r of results) {
      const v = r.result as { links: { href: string; text: string }[]; iframes: string[] } | undefined;
      if (v) {
        links.push(...v.links);
        iframes.push(...v.iframes);
      }
    }
    const tab = await browser.tabs.get(tabId);
    const urls = rankMirrorCandidates({ links, iframes, pageUrl: tab.url ?? '' });
    dlog('resolver: harvested', urls.length, 'candidate(s) from tab', tabId);
    return urls;
  } catch {
    return [];
  }
}

// Per-frame diagnostics so the 🔧 debug panel can show why a real site did/didn't list games.
interface FrameDiag {
  frame: string;
  anchors: number;
  clickish: number;
  vsCount: number;
  vsSample: string[];
}

// Schedule scan (POWER): per-target {href,text,slug,context} + JSON-LD + diagnostics. Structure-agnostic
// (no per-site selectors). Harvests BOTH <a href> AND clickable non-anchors (these sites often render
// games as onclick/data-* <div>s to fire popunders + dodge scrapers). `parseEvents` (pure) ranks them.
function scanForEvents(): {
  anchors: { href: string; text: string; slug: string; context: string }[];
  jsonld: { name: string; startDate?: string; url?: string }[];
  diag: FrameDiag;
} {
  const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
  const txt = (el: Element): string => norm((el as HTMLElement).innerText || el.textContent); // innerText keeps boundaries
  const slugOf = (href: string): string => {
    try {
      const segs = new URL(href).pathname.split('/').filter(Boolean);
      for (let i = segs.length - 1; i >= 0; i--) if (/[a-z]/i.test(segs[i]!)) return segs[i]!;
      return segs[segs.length - 1] ?? '';
    } catch {
      return '';
    }
  };
  // This game's card/row = the largest ancestor that still wraps ONLY this one clickable (a multi-link
  // ancestor is the list/grid, not a single card). Structure-agnostic; never grabs the whole schedule.
  const cardText = (el: Element): string => {
    let node: Element | null = el.parentElement;
    let best = '';
    for (let i = 0; i < 5 && node; i++) {
      if (node.querySelectorAll('a[href],[onclick],[data-href],[data-url],[data-link]').length > 1) break;
      const t = txt(node);
      if (t.length > 400) break;
      best = t;
      node = node.parentElement;
    }
    return best;
  };
  const anchors: { href: string; text: string; slug: string; context: string }[] = [];
  const seen = new Set<string>();
  const add = (rawHref: string, el: Element): void => {
    let abs = '';
    try {
      abs = new URL(rawHref, location.href).href;
    } catch {
      return;
    }
    if (!/^https?:/i.test(abs) || seen.has(abs)) return;
    seen.add(abs);
    anchors.push({ href: abs, text: txt(el).slice(0, 200), slug: slugOf(abs), context: cardText(el).slice(0, 300) });
  };
  for (const a of [...document.querySelectorAll('a[href]')].slice(0, 800)) add((a as HTMLAnchorElement).href, a);
  // Clickable non-anchors: target URL from data-* or a quoted path in the onclick handler.
  let clickish = 0;
  for (const el of [...document.querySelectorAll('[data-href],[data-url],[data-link],[onclick]')].slice(0, 800)) {
    clickish++;
    let href = el.getAttribute('data-href') || el.getAttribute('data-url') || el.getAttribute('data-link') || '';
    if (!href) {
      const m = (el.getAttribute('onclick') || '').match(/['"`]((?:https?:\/\/|\/)[^'"`]+)['"`]/);
      if (m) href = m[1]!;
    }
    if (href) add(href, el);
  }
  const jsonld: { name: string; startDate?: string; url?: string }[] = [];
  for (const s of [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0, 20)) {
    try {
      const data: unknown = JSON.parse(s.textContent ?? 'null');
      const arr: unknown[] = Array.isArray(data) ? data : ((data as { '@graph'?: unknown[] })?.['@graph'] ?? [data]);
      for (const it of arr) {
        const o = it as { '@type'?: unknown; name?: unknown; startDate?: unknown; url?: unknown };
        const types = Array.isArray(o?.['@type']) ? o['@type'] : [o?.['@type']];
        if (types.some((t) => typeof t === 'string' && /Event/i.test(t)) && o?.name) {
          jsonld.push({ name: String(o.name), startDate: o.startDate ? String(o.startDate) : undefined, url: o.url ? String(o.url) : undefined });
        }
      }
    } catch {
      /* malformed ld+json */
    }
  }
  // Diagnostic: how many "Team vs Team" elements exist regardless of tag, and as what (so we can see
  // whether games are present-but-not-as-links). textContent (no reflow) for the count.
  const SEPv = /\s(?:vs\.?|@)\s/i;
  const vsEls = [...document.querySelectorAll('a,div,li,article,tr,td,h2,h3,h4,p,span,button')]
    .slice(0, 4000)
    .filter((el) => {
      const t = norm(el.textContent);
      return t.length > 4 && t.length < 80 && SEPv.test(t);
    });
  const diag: FrameDiag = {
    frame: location.href.slice(0, 70),
    anchors: document.querySelectorAll('a[href]').length,
    clickish,
    vsCount: vsEls.length,
    vsSample: vsEls.slice(0, 5).map((el) => `<${el.tagName.toLowerCase()}> ${norm(el.textContent).slice(0, 44)}`),
  };
  return { anchors, jsonld, diag };
}

/** Scan every frame of a tab → ranked game list + per-frame diagnostics. */
async function scanEvents(tabId: number): Promise<{ events: EventItem[]; frames: FrameDiag[] }> {
  try {
    const tab = await browser.tabs.get(tabId);
    const results = await browser.scripting.executeScript({ target: { tabId, allFrames: true }, func: scanForEvents });
    const anchors: RawAnchor[] = [];
    const jsonld: LdEvent[] = [];
    const frames: FrameDiag[] = [];
    for (const r of results) {
      const v = r.result as { anchors: RawAnchor[]; jsonld: LdEvent[]; diag: FrameDiag } | undefined;
      if (!v) continue;
      anchors.push(...v.anchors);
      jsonld.push(...v.jsonld);
      frames.push(v.diag);
    }
    const events = parseEvents({ anchors, jsonld, pageUrl: tab.url ?? '' });
    dlog('events: parsed', events.length, 'game(s) from', anchors.length, 'link(s),', frames.length, 'frame(s)');
    return { events, frames };
  } catch {
    return { events: [], frames: [] };
  }
}

// If the best result is only a variant, probe its sibling master playlists and prefer a real master.
async function probeMaster(streams: CapturedStream[]): Promise<CapturedStream[]> {
  const top = streams[0];
  if (!top || top.kind === 'master') return streams;
  for (const cand of deriveMasterCandidates(top.manifestUrl).slice(0, 4)) {
    try {
      const res = await fetch(cand, { signal: AbortSignal.timeout(4000) });
      if (res.ok && isMasterPlaylist((await res.text()).slice(0, 65_536))) {
        const master: CapturedStream = { ...top, key: canonicalKey(cand), manifestUrl: cand, kind: 'master' };
        dlog('resolver: master-probe found', cand);
        return dedupeAndRank([master, ...streams]);
      }
    } catch {
      /* not a master / blocked / timeout */
    }
  }
  return streams;
}

// Resolve until a tab finishes loading (or a cap), so we harvest a fully-rendered page.
function waitForTabComplete(tabId: number, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      browser.tabs.onUpdated.removeListener(onUpd);
      resolve();
    };
    const onUpd = (id: number, info: { status?: string }): void => {
      if (id === tabId && info.status === 'complete') finish();
    };
    browser.tabs.onUpdated.addListener(onUpd);
    browser.tabs.get(tabId).then((t) => t.status === 'complete' && finish()).catch(() => {});
    setTimeout(finish, timeoutMs);
  });
}

// Resolve ONE game (POWER): open its event page in a hidden, ad-suppressed tab, harvest the page's
// mirror links (and capture any stream the page loads directly), then resolve those mirrors to the
// playable .m3u8(s). The 2-level use of the resolver — schedule → event page → mirrors → stream — that
// lets the popup's "Watch" skip every ad page. Still render+observe only (§1201): no token/DRM work.
async function resolveEvent(eventUrl: string, tabId: number): Promise<CapturedStream[]> {
  const safe = safeHttpUrl(eventUrl);
  if (!safe) return [];
  reportResolve(tabId, { phase: 'harvest', done: 0, total: 0, found: 0 });
  let eventTabId: number | undefined;
  let direct: CapturedStream[] = [];
  let mirrors: string[] = [];
  try {
    const tab = await browser.tabs.create({ url: safe, active: false });
    eventTabId = tab.id ?? undefined;
    if (eventTabId == null) return [];
    await injectNeutralizer(eventTabId);
    await waitForTabComplete(eventTabId, 8000);
    mirrors = await harvestTab(eventTabId);
    direct = await getStreams(eventTabId); // the event page may itself be the embed
    if (!mirrors.length && !direct.length) direct = await awaitCapture(eventTabId, 4000); // give a late stream a beat
  } catch {
    /* event page failed to open */
  } finally {
    if (eventTabId != null) await browser.tabs.remove(eventTabId).catch(() => {});
  }
  dlog('resolver: event', safe, '→ direct', direct.length, '+ mirrors', mirrors.length);
  const resolved = mirrors.length ? await resolveMirrors(mirrors, tabId) : [];
  const all = await probeMaster(dedupeAndRank([...direct, ...resolved]));
  reportResolve(tabId, { phase: 'done', done: mirrors.length, total: mirrors.length, found: all.length });
  return all;
}

async function onDetected(tabId: number, streams: CapturedStream[]): Promise<CapturedStream[]> {
  const merged = await addStreams(tabId, streams);
  dlog('captured', streams.map((s) => `${s.source ?? '?'}:${s.kind ?? '?'} ${s.manifestUrl}`), '→ tab', tabId, 'has', merged.length);
  if (POWER) {
    const e = resolverWaiters.get(tabId);
    if (e) {
      e.got = merged;
      if (e.t) clearTimeout(e.t);
      e.t = setTimeout(() => finishResolver(tabId), 1200); // debounce: collect a few, then settle + close
    }
  }
  await setBadge(tabId, merged.length);
  return merged;
}

async function detectActiveTab(tabId: number): Promise<CapturedStream[]> {
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: scanPage,
    });
    const found: CapturedStream[] = [];
    for (const r of results) {
      for (const { u, ref } of (r.result as Array<{ u: string; ref: string }> | undefined) ?? []) {
        found.push(toStream(u, tabId, r.frameId ?? 0, ref, undefined, 'scan'));
      }
    }
    if (found.length) await onDetected(tabId, found);
  } catch {
    /* injection blocked (e.g. chrome:// page) — fall through to whatever is stored */
  }
  return dedupeAndRank(await getStreams(tabId));
}

async function handle(
  msg: Message,
  sender: { tab?: { id?: number }; url?: string; frameId?: number },
): Promise<StreamsResponse | EventsResponse | EventsDebugResponse | PlaybackResponse | OkResponse | ErrorResponse> {
  // Sensitive messages — only our own extension pages (popup/player) may send them (defense in
  // depth). Playback messages install header rules / read stashed streams; DETECT/GET_STREAMS read a
  // tab's captures by a caller-supplied tabId, so gate them too. The deep-capture content script that
  // exists today sends only CONTENT_STREAM, which is non-sensitive and validated below.
  if (
    (msg.type === 'OPEN_PLAYER' ||
      msg.type === 'PREPARE_MIRROR' ||
      msg.type === 'GET_PLAYBACK' ||
      msg.type === 'REMEMBER_WORKING' ||
      msg.type === 'DETECT' ||
      msg.type === 'GET_STREAMS' ||
      msg.type === 'RESOLVE_PAGE' ||
      msg.type === 'LIST_EVENTS' ||
      msg.type === 'RESOLVE_EVENT' ||
      msg.type === 'EVENTS_DEBUG') &&
    !fromExtensionPage(sender)
  ) {
    return { error: 'forbidden' };
  }

  switch (msg.type) {
    case 'DETECT':
      return { streams: await detectActiveTab(msg.tabId) };

    case 'GET_STREAMS':
      return { streams: dedupeAndRank(await getStreams(msg.tabId)) };

    case 'RESOLVE_PAGE': {
      // POWER only: harvest the page's mirror/embed candidates (or use provided urls), render each in a
      // hidden tab, return what resolves. Folds to [] in store builds → tree-shaken.
      if (!POWER) return { streams: [] };
      if (msg.urls == null) reportResolve(msg.tabId, { phase: 'harvest', done: 0, total: 0, found: 0 });
      const urls = msg.urls ?? (await harvestTab(msg.tabId));
      return { streams: await resolveMirrors(urls, msg.tabId) };
    }

    case 'LIST_EVENTS':
      // POWER only: parse this tab's schedule page into a game list. Folds to [] in store builds.
      return POWER ? { events: (await scanEvents(msg.tabId)).events } : { events: [] };

    case 'RESOLVE_EVENT':
      // POWER only: open one game's event page in hidden tabs, harvest + resolve it → ranked streams.
      return POWER ? { streams: await resolveEvent(msg.url, msg.tabId) } : { streams: [] };

    case 'EVENTS_DEBUG': {
      // POWER only (the 🔧 debug panel): event-scan diagnostics so a real site shows why it did/didn't list.
      if (!POWER) return { parsed: 0, frames: [] };
      const r = await scanEvents(msg.tabId);
      return { parsed: r.events.length, frames: r.frames };
    }

    case 'OPEN_PLAYER': {
      // Reject any non-http(s) manifest URL before it can reach the player / header injection.
      const streams = msg.streams.filter((s) => safeHttpUrl(s.manifestUrl));
      if (!streams.length) return { error: 'No playable stream URL' };
      const hash = '#src=' + encodeURIComponent(streams[0]!.manifestUrl);
      const tab = await browser.tabs.create({ url: PLAYER_URL + hash });
      if (tab.id != null) await browser.storage.session.set({ [playbackKey(tab.id)]: streams });
      return { ok: true };
    }

    case 'GET_PLAYBACK': {
      const tabId = sender.tab?.id;
      if (tabId == null) return { streams: [] };
      return { streams: await getPlayback(tabId) };
    }

    case 'PREPARE_MIRROR': {
      // Install (or clear) header injection for the chosen mirror BEFORE the player loads it,
      // so headers are live before hls.js's first request (race-free).
      const tabId = sender.tab?.id;
      if (tabId == null) return { ok: true };
      const streams = await getPlayback(tabId);
      const stream = streams[msg.index];
      let headers: ReplayHeaders = stream ? effectiveHeaders(stream) : {};
      // If this capture had no Referer/Cookie, fall back to what worked before on this host.
      if (stream && !headers.referer && !headers.cookie) {
        try {
          const remembered = await recallWorkingHeaders(new URL(stream.manifestUrl).hostname);
          if (remembered) headers = { ...remembered, ...headers };
        } catch {
          /* not a URL */
        }
      }
      // apply() with no headers clears any prior mirror's rule; hosts scope injection to the granted
      // CDNs so headers never leak to an unrelated host.
      await injector.apply(tabId, headers, hostsOf(streams));
      return { ok: true };
    }

    case 'REMEMBER_WORKING': {
      // The player reports a mirror is playing healthily → persist its headers for this CDN host.
      const tabId = sender.tab?.id;
      if (tabId == null) return { ok: true };
      const stream = (await getPlayback(tabId))[msg.index];
      if (stream) {
        try {
          await rememberWorkingHeaders(new URL(stream.manifestUrl).hostname, effectiveHeaders(stream));
        } catch {
          /* not a URL */
        }
      }
      return { ok: true };
    }
    case 'CONTENT_STREAM': {
      // From the deep-capture content script (a page-world hook); validate before trusting.
      const tabId = sender.tab?.id;
      if (tabId == null || !isManifestUrl(msg.url) || !safeHttpUrl(msg.url)) return { ok: true };
      void onDetected(tabId, [toStream(msg.url, tabId, sender.frameId ?? 0, msg.pageUrl, undefined, 'deep')]);
      return { ok: true };
    }
    default:
      return { error: 'Unknown message type' };
  }
}

export default defineBackground(() => {
  // Passive detection — inert until the user grants host access; re-armed on every grant change so a
  // grant made after startup actually takes effect (Chrome won't retroactively match a pre-registered
  // listener to newly-granted hosts).
  rearmPassive();
  void syncDeepCapture();
  browser.permissions.onAdded.addListener(() => {
    rearmPassive();
    void syncDeepCapture();
  });
  browser.permissions.onRemoved.addListener(() => {
    rearmPassive();
    void syncDeepCapture();
  });

  browser.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
    // Always answer the port — including on rejection — so callers (player GET_PLAYBACK /
    // PREPARE_MIRROR) never hang on an unresolved sendMessage.
    void handle(msg, sender).then(sendResponse, (err) => sendResponse({ error: String(err) }));
    return true; // async response
  });

  // Reset per-tab detection on navigation; tear everything down on tab close.
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading' && changeInfo.url) {
      void clearTab(tabId).then(() => setBadge(tabId, 0));
      // If a PLAYER tab navigates AWAY (not its initial load of player.html), tear down its header
      // rule + stashed playback so a reused tab id can't inherit a stale Referer/Cookie.
      if (!changeInfo.url.startsWith(PLAYER_URL)) {
        void injector.clear(tabId);
        void browser.storage.session.remove(playbackKey(tabId));
      }
    }
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    void clearTab(tabId);
    void injector.clear(tabId);
    void browser.storage.session.remove(playbackKey(tabId));
  });

  // On (re)start, drop any header rules whose player tab is gone.
  void browser.tabs
    .query({})
    .then((tabs) => injector.reconcile(tabs.map((t) => t.id).filter((id): id is number => id != null)))
    .catch(() => {});
});
