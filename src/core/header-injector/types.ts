// One interface, two backends (Chrome DNR / Firefox blocking webRequest), selected at build time.
// See docs/research/08-cross-browser.md and docs/decisions.md (D7).
import type { ReplayHeaders } from '@/core/types';

export interface HeaderInjector {
  /** Inject `headers` on requests from `tabId`'s player, scoped to `hosts` (the granted CDN
   *  hostnames) so an injected Referer can't ride along to an arbitrary host a playlist references.
   *  Empty/omitted `hosts` = unscoped (the direct-link fallback path). */
  apply(tabId: number, headers: ReplayHeaders, hosts?: string[]): Promise<void>;
  /** Remove injection for `tabId` (call on tab close / playback end). */
  clear(tabId: number): Promise<void>;
  /** Drop injection for tabs that no longer exist (call on SW / event-page restart). */
  reconcile(liveTabIds: number[]): Promise<void>;
}
