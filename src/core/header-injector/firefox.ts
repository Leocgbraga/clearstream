// Firefox backend: blocking webRequest.onBeforeSendHeaders (retained in Firefox MV3). We keep a
// per-tab header map and rewrite on the fly; Firefox's DNR domain conditions are buggy, so this is
// the better path here. The listener is registered lazily on first apply() and filters by tabId.
// Note: the map is in-memory; if the event page is evicted mid-playback the headers reset — in
// practice active playback keeps the page alive. See docs/research/08-cross-browser.md.
import { browser } from 'wxt/browser';
import type { ReplayHeaders } from '@/core/types';
import type { HeaderInjector } from './types';
import { upsertHeader, type WebRequestHeader } from './merge';

type Details = { tabId: number; requestHeaders?: WebRequestHeader[] };

export class WebRequestInjector implements HeaderInjector {
  readonly #byTab = new Map<number, ReplayHeaders>();
  #listening = false;

  readonly #onBeforeSendHeaders = (details: Details): { requestHeaders?: WebRequestHeader[] } => {
    const wanted = this.#byTab.get(details.tabId);
    if (!wanted) return {};
    const headers = details.requestHeaders ?? [];
    upsertHeader(headers, 'Referer', wanted.referer);
    upsertHeader(headers, 'Cookie', wanted.cookie);
    upsertHeader(headers, 'User-Agent', wanted.userAgent);
    return { requestHeaders: headers };
  };

  #ensureListening(): void {
    if (this.#listening) return;
    browser.webRequest.onBeforeSendHeaders.addListener(
      this.#onBeforeSendHeaders as Parameters<typeof browser.webRequest.onBeforeSendHeaders.addListener>[0],
      { urls: ['<all_urls>'] },
      ['blocking', 'requestHeaders'],
    );
    this.#listening = true;
  }

  async apply(tabId: number, headers: ReplayHeaders): Promise<void> {
    this.#byTab.set(tabId, headers);
    this.#ensureListening();
  }

  async clear(tabId: number): Promise<void> {
    this.#byTab.delete(tabId);
  }
}
