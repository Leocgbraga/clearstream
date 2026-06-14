// Firefox backend: blocking webRequest.onBeforeSendHeaders (retained in Firefox MV3). We keep a
// per-tab {headers, hosts} map and rewrite on the fly, only for requests to the granted CDN hosts so
// an injected Referer can't ride along to an arbitrary host a playlist references. Firefox's DNR
// domain conditions are buggy, so this is the better path here. The listener is registered lazily on
// first apply(), filters by tabId, and is removed once no tab needs injection. The map is in-memory;
// if the event page is evicted mid-playback the headers reset (active playback usually keeps it
// alive). See research/08.
import { browser } from 'wxt/browser';
import type { ReplayHeaders } from '@/core/types';
import type { HeaderInjector } from './types';
import { upsertHeader, type WebRequestHeader } from './merge';

type Details = { tabId: number; url: string; requestHeaders?: WebRequestHeader[] };
interface TabRule {
  headers: ReplayHeaders;
  hosts: Set<string>;
}

export class WebRequestInjector implements HeaderInjector {
  readonly #byTab = new Map<number, TabRule>();
  #listening = false;

  readonly #onBeforeSendHeaders = (details: Details): { requestHeaders?: WebRequestHeader[] } => {
    const rule = this.#byTab.get(details.tabId);
    if (!rule) return {};
    if (rule.hosts.size) {
      let host = '';
      try {
        host = new URL(details.url).hostname;
      } catch {
        return {};
      }
      if (!rule.hosts.has(host)) return {}; // not a granted CDN host → don't inject
    }
    const headers = details.requestHeaders ?? [];
    upsertHeader(headers, 'Referer', rule.headers.referer);
    upsertHeader(headers, 'Cookie', rule.headers.cookie);
    upsertHeader(headers, 'User-Agent', rule.headers.userAgent);
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

  /** Drop the global blocking listener once no tab needs header injection (re-added on next apply).
   *  A blocking onBeforeSendHeaders left attached would tax every request in the browser for nothing,
   *  and would keep rewriting after the user revokes host access. */
  #teardownIfIdle(): void {
    if (this.#byTab.size > 0 || !this.#listening) return;
    browser.webRequest.onBeforeSendHeaders.removeListener(
      this.#onBeforeSendHeaders as Parameters<typeof browser.webRequest.onBeforeSendHeaders.removeListener>[0],
    );
    this.#listening = false;
  }

  async apply(tabId: number, headers: ReplayHeaders, hosts: string[] = []): Promise<void> {
    this.#byTab.set(tabId, { headers, hosts: new Set(hosts) });
    this.#ensureListening();
  }

  async clear(tabId: number): Promise<void> {
    this.#byTab.delete(tabId);
    this.#teardownIfIdle();
  }

  async reconcile(liveTabIds: number[]): Promise<void> {
    const live = new Set(liveTabIds);
    for (const tabId of [...this.#byTab.keys()]) if (!live.has(tabId)) this.#byTab.delete(tabId);
    this.#teardownIfIdle();
  }
}
