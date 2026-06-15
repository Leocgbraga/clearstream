// Multi-mirror stream resolver — POWER build only (off-store). CS_POWER_RESOLVER
//
// Opens a candidate embed/mirror URL in a hidden background tab, suppresses the popunder/redirect
// malvertising it fires, lets the existing MAIN-world deep-capture catch the .m3u8 the page itself
// loads, then closes the tab and returns the captured streams. It only RENDERS the page and OBSERVES
// what it loads — it NEVER decrypts or forges tokens, and never touches DRM (the §1201 line). See POWER.md.
import { browser } from 'wxt/browser';
import type { CapturedStream } from '@/core/types';

// Injected (world: MAIN, per-tab) to neutralize the popunder / new-tab / redirect malvertising the
// embed fires on load. Scoped to the resolver's OWN tabs via executeScript({target:{tabId}}) — it never
// touches the user's normal browsing. Best-effort; deep-capture does the actual stream capturing.
function neutralizePage(): void {
  try {
    Object.defineProperty(window, 'open', { value: () => null, configurable: true });
  } catch {
    /* window.open non-configurable */
  }
  window.addEventListener(
    'click',
    (e) => {
      const a = (e.target as Element | null)?.closest?.('a[target="_blank"]');
      if (a) e.preventDefault();
    },
    true,
  );
  try {
    document.querySelectorAll('meta[http-equiv="refresh" i]').forEach((m) => m.remove());
  } catch {
    /* ignore */
  }
}

/** Resolves the first deep-capture(s) seen on a tab; the background wires this to its onDetected hook. */
export type AwaitCapture = (tabId: number, timeoutMs: number) => Promise<CapturedStream[]>;

/** Resolve ONE embed/mirror URL → the .m3u8(s) it loads. Opens a hidden tab, suppresses ads, waits for
 *  deep-capture, and ALWAYS cleans up the tab. Returns [] on timeout/failure (never throws). */
export async function resolveInTab(url: string, awaitCapture: AwaitCapture, timeoutMs = 18_000): Promise<CapturedStream[]> {
  let tabId: number | undefined;
  try {
    const tab = await browser.tabs.create({ url, active: false });
    tabId = tab.id ?? undefined;
    if (tabId == null) return [];
    await injectNeutralizer(tabId);
    return await awaitCapture(tabId, timeoutMs);
  } catch {
    return [];
  } finally {
    if (tabId != null) await browser.tabs.remove(tabId).catch(() => {});
  }
}

export async function injectNeutralizer(tabId: number): Promise<void> {
  const exec = browser.scripting.executeScript as unknown as (o: unknown) => Promise<unknown>;
  try {
    await exec({ target: { tabId, allFrames: true }, world: 'MAIN', injectImmediately: true, func: neutralizePage });
  } catch {
    /* host not granted / tab already navigated away */
  }
}
