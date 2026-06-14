// ClearStream background — capture engine (Phase 1) + header-injection orchestration (Phase 3).
//
// Detection (hybrid, decision D6):
//   • Click-to-detect (default): popup sends DETECT → scan the active tab via activeTab + scripting
//     (Performance API + DOM, all frames), capturing each frame's URL as the referer. No broad perms.
//   • Passive (optional): top-level webRequest observers fire only for hosts the user granted via the
//     "auto-detect on all sites" toggle → badge + capture request headers (incl. Referer/Cookie).
//
// Playback (Phase 3): popup → OPEN_PLAYER stashes the chosen stream keyed by the new player tab id
// and opens player.html. The player then calls GET_PLAYBACK, which installs a tab-scoped header
// rule (DNR on Chrome / blocking webRequest on Firefox) BEFORE returning — so headers are in place
// before hls.js makes its first request (race-free). See docs/research/{06,07,08}.
import { browser } from 'wxt/browser';
import type { CapturedStream, ReplayHeaders } from '@/core/types';
import { canonicalKey, classifyByUrl, dedupeAndRank, isManifestUrl } from '@/core/detection';
import { addStreams, clearTab, getStreams } from '@/core/storage';
import type { Message, OkResponse, PlaybackResponse, StreamsResponse } from '@/core/messages';
import { createHeaderInjector } from '@/core/header-injector';

const injector = createHeaderInjector();
const playbackKey = (tabId: number): string => `playback:${tabId}`;

/** Injected into each frame of the active tab (activeTab grant). Returns the manifest URLs already
 *  loaded (Performance API) or in the DOM, each paired with that frame's URL (used as referer). */
function scanPage(): Array<{ u: string; ref: string }> {
  const found = new Map<string, string>();
  const re = /\.(m3u8|mpd)(\?|#|$)/i;
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

const hasAnyHeader = (h: ReplayHeaders): boolean => Boolean(h.referer || h.cookie || h.userAgent);

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
  sender: { tab?: { id?: number } },
): Promise<StreamsResponse | PlaybackResponse | OkResponse> {
  switch (msg.type) {
    case 'DETECT':
      return { streams: await detectActiveTab(msg.tabId) };

    case 'GET_STREAMS':
      return { streams: dedupeAndRank(await getStreams(msg.tabId)) };

    case 'OPEN_PLAYER': {
      const tab = await browser.tabs.create({
        url: browser.runtime.getURL('/player.html') + '#src=' + encodeURIComponent(msg.stream.manifestUrl),
      });
      if (tab.id != null) await browser.storage.session.set({ [playbackKey(tab.id)]: msg.stream });
      return { ok: true };
    }

    case 'GET_PLAYBACK': {
      const tabId = sender.tab?.id;
      if (tabId == null) return { stream: null };
      const key = playbackKey(tabId);
      const got = await browser.storage.session.get(key);
      const stream = (got[key] as CapturedStream | undefined) ?? null;
      if (stream) {
        const headers = effectiveHeaders(stream);
        // Install BEFORE responding so headers are live before the player's first fetch.
        if (hasAnyHeader(headers)) await injector.apply(tabId, headers);
      }
      return { stream };
    }
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
    void handle(msg, sender).then(sendResponse);
    return true; // async response
  });

  // Reset per-tab detection on navigation; tear everything down on tab close.
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading' && changeInfo.url) {
      void clearTab(tabId).then(() => setBadge(tabId, 0));
    }
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    void clearTab(tabId);
    void injector.clear(tabId);
    void browser.storage.session.remove(playbackKey(tabId));
  });
});
