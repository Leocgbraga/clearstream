// One interface, two backends (Chrome DNR / Firefox blocking webRequest), selected at build time.
// See docs/research/08-cross-browser.md and docs/decisions.md (D7).
import type { ReplayHeaders } from '@/core/types';

export interface HeaderInjector {
  /** Inject the given request headers on all manifest/segment requests from `tabId`'s player. */
  apply(tabId: number, headers: ReplayHeaders): Promise<void>;
  /** Remove injection for `tabId` (call on tab close / playback end). */
  clear(tabId: number): Promise<void>;
}
