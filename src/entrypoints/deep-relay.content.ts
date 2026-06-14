// ISOLATED-world relay for the MAIN-world deep-capture hook (deep-main.content.ts). Runtime-registered
// alongside it. Receives postMessage'd .m3u8 finds from the page world and forwards them to the
// background, which validates + stores them. (MAIN world can't reach the extension API directly.)
import { browser } from 'wxt/browser';

export default defineContentScript({
  // Empty matches: registered at runtime only after the all-sites grant (see deep-main.content.ts).
  matches: [],
  registration: 'runtime',
  world: 'ISOLATED',
  runAt: 'document_start',
  allFrames: true,
  main() {
    window.addEventListener('message', (e: MessageEvent) => {
      const d = e.data as { __clearstream__?: string; url?: string } | null;
      if (e.source === window && d?.__clearstream__ === 'stream' && typeof d.url === 'string') {
        void browser.runtime.sendMessage({ type: 'CONTENT_STREAM', url: d.url, pageUrl: location.href });
      }
    });
  },
});
