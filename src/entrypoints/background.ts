// ClearStream background — capture engine (Phase 1).
// Two detection paths (hybrid, per decision D6):
//   • Click-to-detect (default): popup sends DETECT → we scan the active tab via activeTab +
//     scripting (Performance API + DOM), no broad host permission.
//   • Passive (optional): webRequest observers registered at top level fire ONLY for hosts the
//     user granted via the "auto-detect on all sites" toggle (else inert) → badge + capture.
// All listeners registered synchronously at top level (SW is ephemeral).
// See docs/research/06-capture-engine.md and docs/research/09-ux-permissions.md.
import { browser } from 'wxt/browser';
import type { CapturedStream, ReplayHeaders } from '@/core/types';
import { canonicalKey, classifyByUrl, dedupeAndRank, isManifestUrl } from '@/core/detection';
import { addStreams, clearTab, getStreams } from '@/core/storage';
import type { Message, StreamsResponse } from '@/core/messages';

/** Injected into each frame of the active tab (activeTab grant). Returns manifest URLs that are
 *  already loaded (Performance Resource Timing) or referenced in the DOM. */
function scanPage(): string[] {
  const out = new Set<string>();
  const re = /\.(m3u8|mpd)(\?|#|$)/i;
  try {
    for (const e of performance.getEntriesByType('resource')) {
      if (re.test(e.name)) out.add(e.name);
    }
  } catch {
    /* ignore */
  }
  try {
    document.querySelectorAll('video,source').forEach((el) => {
      const m = el as HTMLMediaElement;
      const s = m.src || m.currentSrc || el.getAttribute('src') || '';
      if (s && re.test(s)) out.add(s);
    });
  } catch {
    /* ignore */
  }
  return [...out];
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
      const urls = (r.result as string[] | undefined) ?? [];
      for (const url of urls) found.push(toStream(url, tabId, r.frameId ?? 0, ''));
    }
    if (found.length) await onDetected(tabId, found);
  } catch {
    /* injection blocked (e.g. chrome:// page) — fall through to stored */
  }
  return dedupeAndRank(await getStreams(tabId));
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

  browser.runtime.onMessage.addListener((msg: Message, _sender, sendResponse) => {
    void (async (): Promise<StreamsResponse | { ok: true }> => {
      switch (msg.type) {
        case 'DETECT':
          return { streams: await detectActiveTab(msg.tabId) };
        case 'GET_STREAMS':
          return { streams: dedupeAndRank(await getStreams(msg.tabId)) };
        case 'OPEN_PLAYER':
          await browser.tabs.create({
            url: browser.runtime.getURL('/player.html') + '#src=' + encodeURIComponent(msg.url),
          });
          return { ok: true };
      }
    })().then(sendResponse);
    return true; // async response
  });

  // Reset per-tab streams on navigation + tab close.
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading' && changeInfo.url) {
      void clearTab(tabId).then(() => setBadge(tabId, 0));
    }
  });
  browser.tabs.onRemoved.addListener((tabId) => void clearTab(tabId));
});
