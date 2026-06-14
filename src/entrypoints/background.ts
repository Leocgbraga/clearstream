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

const injector = createHeaderInjector();
const playbackKey = (tabId: number): string => `playback:${tabId}`;
const PLAYER_URL = browser.runtime.getURL('/player.html');

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
): CapturedStream {
  return {
    key: canonicalKey(url),
    manifestUrl: url,
    tabId,
    frameId,
    pageUrl,
    replayHeaders: headers ?? {},
    kind: classifyByUrl(url),
    createdAt: Date.now(),
  };
}

/** Best available headers to replay: captured ones, else a referer derived from the page URL. */
function effectiveHeaders(stream: CapturedStream): ReplayHeaders {
  const h: ReplayHeaders = { ...stream.replayHeaders };
  if (!h.referer && stream.pageUrl) {
    try {
      h.referer = new URL(stream.pageUrl).origin + '/';
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

async function setBadge(tabId: number, count: number): Promise<void> {
  try {
    await browser.action.setBadgeText({ tabId, text: count ? String(count) : '' });
    await browser.action.setBadgeBackgroundColor({ color: '#14b8a6' });
  } catch {
    /* tab may be gone */
  }
}

async function onDetected(tabId: number, streams: CapturedStream[]): Promise<CapturedStream[]> {
  const merged = await addStreams(tabId, streams);
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
        found.push(toStream(u, tabId, r.frameId ?? 0, ref));
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
  sender: { tab?: { id?: number }; url?: string },
): Promise<StreamsResponse | PlaybackResponse | OkResponse | ErrorResponse> {
  // Playback messages install header rules / read stashed streams — only our own pages may send them
  // (defense in depth; today there's no externally_connectable/content script, but a content script
  // arrives in a later phase and must use a different, non-sensitive message type).
  if (
    (msg.type === 'OPEN_PLAYER' || msg.type === 'PREPARE_MIRROR' || msg.type === 'GET_PLAYBACK') &&
    !fromExtensionPage(sender)
  ) {
    return { error: 'forbidden' };
  }

  switch (msg.type) {
    case 'DETECT':
      return { streams: await detectActiveTab(msg.tabId) };

    case 'GET_STREAMS':
      return { streams: dedupeAndRank(await getStreams(msg.tabId)) };

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
      const key = playbackKey(tabId);
      const got = await browser.storage.session.get(key);
      return { streams: (got[key] as CapturedStream[] | undefined) ?? [] };
    }

    case 'PREPARE_MIRROR': {
      // Install (or clear) header injection for the chosen mirror BEFORE the player loads it,
      // so headers are live before hls.js's first request (race-free).
      const tabId = sender.tab?.id;
      if (tabId == null) return { ok: true };
      const key = playbackKey(tabId);
      const got = await browser.storage.session.get(key);
      const streams = (got[key] as CapturedStream[] | undefined) ?? [];
      const stream = streams[msg.index];
      // apply() with no headers clears any prior mirror's rule; hosts scope injection to the granted
      // CDNs so headers never leak to an unrelated host.
      await injector.apply(tabId, stream ? effectiveHeaders(stream) : {}, hostsOf(streams));
      return { ok: true };
    }
    default:
      return { error: 'Unknown message type' };
  }
}

export default defineBackground(() => {
  // Passive observers — inert until the user grants host access via the popup toggle.
  browser.webRequest.onBeforeRequest.addListener(
    (d) => {
      if (d.tabId >= 0 && isManifestUrl(d.url)) {
        const pageUrl = (d as { initiator?: string; documentUrl?: string }).initiator
          ?? (d as { documentUrl?: string }).documentUrl
          ?? '';
        void onDetected(d.tabId, [toStream(d.url, d.tabId, d.frameId, pageUrl)]);
      }
      return undefined;
    },
    { urls: ['<all_urls>'], types: ['xmlhttprequest', 'media', 'other'] },
  );

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
