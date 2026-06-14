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
import type { ErrorResponse, Message, OkResponse, PlaybackResponse, StreamsResponse } from '@/core/messages';
import { createHeaderInjector } from '@/core/header-injector';
import { safeHttpUrl } from '@/core/url-safety';
import { recallWorkingHeaders, rememberWorkingHeaders } from '@/core/prefs';
import { dlog } from '@/core/debug';
import { POWER } from '@/core/power';
import { resolveInTab, type AwaitCapture } from '@/core/resolver/resolve-tab';
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

/** Resolve a list of embed/mirror URLs → a deduped, ranked stream list (bounded concurrency). */
async function resolveMirrors(urls: string[]): Promise<CapturedStream[]> {
  const MAX = 8;
  const POOL = 3;
  const list = urls.slice(0, MAX);
  if (urls.length > MAX) dlog('resolver: capped', urls.length, '→', MAX, 'mirrors');
  const all: CapturedStream[] = [];
  let i = 0;
  const worker = async (): Promise<void> => {
    while (i < list.length) {
      const url = list[i++]!;
      const streams = await resolveInTab(url, awaitCapture);
      dlog('resolver:', url, '→', streams.length, 'stream(s)');
      all.push(...streams);
    }
  };
  await Promise.all(Array.from({ length: Math.min(POOL, list.length) || 1 }, worker));
  return probeMaster(dedupeAndRank(all));
}

// Harvest the page's mirror/embed candidates: DOM scan via scripting (all frames) → pure ranking.
function scanForMirrors(): { links: { href: string; text: string }[]; iframes: string[] } {
  const links = [...document.querySelectorAll('a[href]')].map((a) => ({
    href: (a as HTMLAnchorElement).href,
    text: (a.textContent ?? '').trim().slice(0, 80),
  }));
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
): Promise<StreamsResponse | PlaybackResponse | OkResponse | ErrorResponse> {
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
      msg.type === 'RESOLVE_PAGE') &&
    !fromExtensionPage(sender)
  ) {
    return { error: 'forbidden' };
  }

  switch (msg.type) {
    case 'DETECT':
      return { streams: await detectActiveTab(msg.tabId) };

    case 'GET_STREAMS':
      return { streams: dedupeAndRank(await getStreams(msg.tabId)) };

    case 'RESOLVE_PAGE':
      // POWER only: harvest the page's mirror/embed candidates (or use provided urls), render each in a
      // hidden tab, return what resolves. Folds to [] in store builds → tree-shaken.
      return POWER ? { streams: await resolveMirrors(msg.urls ?? (await harvestTab(msg.tabId))) } : { streams: [] };

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
