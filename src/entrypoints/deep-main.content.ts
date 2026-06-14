// MAIN-world deep capture (Chromium only; runtime-registered by the background only after the user
// grants all-sites access — so it adds no install warning). Hooks fetch/XHR at document_start to
// catch .m3u8 URLs the Performance/DOM scan misses: blob/obfuscated manifests and URLs embedded in
// JSON/text response bodies. MAIN world has no extension API, so it relays finds via postMessage to
// the ISOLATED relay (deep-relay.content.ts). See docs/research/06-capture-engine.md (L2).
export default defineContentScript({
  // Empty matches: this is registered at runtime (with matches) only after the all-sites grant, so it
  // must NOT add <all_urls> to the manifest's host_permissions (that would re-introduce the warning).
  matches: [],
  registration: 'runtime',
  world: 'MAIN',
  runAt: 'document_start',
  allFrames: true,
  main() {
    const RE = /\.m3u8(\?|#|$)/i;
    const ABS = /https?:\/\/[^"'\\\s)]+\.m3u8[^"'\\\s)]*/gi;
    const seen = new Set<string>();
    const report = (url?: string | null): void => {
      if (!url || seen.has(url) || !RE.test(url)) return;
      seen.add(url);
      window.postMessage({ __clearstream__: 'stream', url }, '*');
    };
    const scanText = (text: string): void => {
      const m = text.match(ABS);
      if (m) for (const u of m) report(u);
    };

    try {
      const orig = window.fetch;
      window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
        try {
          report(typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url);
        } catch {
          /* ignore */
        }
        return orig.call(window, input as RequestInfo, init).then((res) => {
          try {
            const ct = res.headers.get('content-type') ?? '';
            if (RE.test(res.url) || /mpegurl|application\/json|text\//i.test(ct)) {
              void res.clone().text().then(scanText).catch(() => {});
            }
          } catch {
            /* ignore */
          }
          return res;
        });
      } as typeof window.fetch;
    } catch {
      /* page froze fetch, etc. */
    }

    try {
      const open = XMLHttpRequest.prototype.open as (...a: unknown[]) => void;
      XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
        try {
          report(typeof url === 'string' ? url : url.href);
          this.addEventListener('load', () => {
            try {
              const ct = this.getResponseHeader('content-type') ?? '';
              if (/mpegurl|application\/json|text\//i.test(ct) && typeof this.responseText === 'string') {
                scanText(this.responseText);
              }
            } catch {
              /* opaque/binary response */
            }
          });
        } catch {
          /* ignore */
        }
        return open.call(this, method, url, ...rest);
      } as typeof XMLHttpRequest.prototype.open;
    } catch {
      /* ignore */
    }
  },
});
