# Research 06 — Capture engine (detection, header capture, SW survival)

> Verbatim research report. A single layer caps ~70% on hostile sports sites → use **three
> cooperating layers** with a shared dedupe/keying store. cat-catch = gold standard for breadth
> (hooks fetch/XHR/Worker/JSON.parse/TextDecoder/MediaSource in MAIN world); puemos = cleaner
> arch but weaker here (keys off `onCompleted`+responseHeaders, never captures request
> Cookie/Referer/Origin). **Combine cat-catch's request-header capture with puemos' storage model.**

## 1. Layered detection
| Layer | Catches | v1? | Cost |
|---|---|---|---|
| **L1: webRequest observer (SW)** | direct `.m3u8`, segments, requests in cross-origin iframes (SW sees all frames), content-type-typed manifests w/ no `.m3u8` in URL | **core** | Low |
| **L2: MAIN-world fetch/XHR hook (content script)** | blob:/runtime-built/redirected URLs, AES keys, data: manifests, in-Worker fetches | **high value** | Medium |
| **L3: MediaSource.appendBuffer capture** | DRM-free MSE where no `.m3u8` hits the wire | Later | High (reconstruct, not replay) |

L1 alone misses: (a) `Content-Type: application/vnd.apple.mpegurl` with a URL like `/api/stream?id=`
(no `.m3u8`), (b) manifest fetched in a sandboxed iframe then handed to hls.js as a `blob:`,
(c) base64-embedded in a JSON API response.

### L1 — webRequest observer (core)
Myth correction: **`webRequest` observation is fully available to normal MV3 extensions** — only
`webRequestBlocking` is policy-gated. Don't filter only by `*.m3u8` URL (misses extensionless
manifests) — filter broad, confirm by content-type, and by `#EXTM3U` body sniff from L2.
```ts
const FILTER = { urls:["*://*/*.m3u8","*://*/*.m3u8?*","*://*/*.mpd","*://*/*.mpd?*"] };
chrome.webRequest.onSendHeaders.addListener(d=>onManifestSeen(d,true), FILTER,
  ["requestHeaders","extraHeaders"]);                 // extraHeaders mandatory for Referer/Cookie/Origin
chrome.webRequest.onHeadersReceived.addListener(d=>{   // safety net: confirm by content-type
  const ct=d.responseHeaders?.find(h=>h.name.toLowerCase()==="content-type")?.value??"";
  if(/mpegurl|x-mpegurl|vnd\.apple\.mpegurl/i.test(ct)) promoteByContentType(d.requestId,d.url,d.tabId);
}, {urls:["<all_urls>"],types:["xmlhttprequest","media","other"]}, ["responseHeaders"]);
```
`onSendHeaders` fires after `onBeforeSendHeaders` (final header set) → right place to *read*.

### L2 — MAIN-world fetch/XHR hook (the differentiator)
Inject into the page MAIN world at `document_start`; monkey-patch network + decode primitives.
Patched `fetch` clones every response, sniffs for `#EXTM3U`, reports the request URL (or mints a
blob for POST-fetched/inline manifests) to the ISOLATED relay via `window.postMessage`.
cat-catch also patches: `XMLHttpRequest.open` (readystatechange sniff), `Worker` (instruments
hls.js-in-worker), `JSON.parse` (recursive walk for embedded URLs/keys), `TextDecoder.decode`
(text starting `#EXTM3U` → mint blob), `atob`/typed-array key heuristics. Anti-detection:
`fetch.toString = () => _fetch.toString()`.
```jsonc
"content_scripts":[
 {"matches":["<all_urls>"],"all_frames":true,"match_about_blank":true,
  "match_origin_as_fallback":true,"run_at":"document_start","js":["relay.js"]},          // ISOLATED relay → SW
 {"matches":["<all_urls>"],"all_frames":true,"match_about_blank":true,
  "match_origin_as_fallback":true,"run_at":"document_start","world":"MAIN","js":["hooks.js"]} // page hooks
]
```
`match_origin_as_fallback:true` is **required** to reach blob:/about:blank/sandboxed iframes — the
exact embed players these sites use. Two-script split is mandatory (MAIN can touch page `fetch` but
can't call `chrome.runtime.sendMessage`; ISOLATED relay can). They talk via nonce'd `postMessage`.

### L3 — MediaSource capture (later, different feature)
Proxy `addSourceBuffer`/`appendBuffer`, accumulate chunks, finalize on `endOfStream`. Does **not**
yield a `.m3u8` for hls.js — only raw fMP4/TS to mux yourself. **Defer** (download fallback only).

## 2. Header capture done right
```ts
chrome.webRequest.onSendHeaders.addListener(d=>{
  const h={}; for(const {name,value} of d.requestHeaders??[]) h[name.toLowerCase()]=value??"";
  captureManifest({ url:d.url, tabId:d.tabId, frameId:d.frameId,
    requestHeaders:{referer:h["referer"],origin:h["origin"],cookie:h["cookie"],userAgent:h["user-agent"]} });
}, FILTER, ["requestHeaders","extraHeaders"]);
```
Reliably available with `extraHeaders`: Referer, Origin, Cookie, User-Agent, Accept*, Sec-Fetch-*,
Range. **Never available: `Authorization`** (Chrome blanks it — biggest replay-failure cause for
token-gated streams). **Keying:** `requestId` is per-request (use only to match onSendHeaders ↔
onHeadersReceived). For associating a manifest with its *later* segment requests, use a durable
key = canonical manifest URL (drop cache-busters, lowercase host); store a per-origin header
profile (segments may hit a different CDN host than the manifest but usually share Referer/Origin).
```ts
interface CapturedStream { key; manifestUrl; tabId; frameId; pageUrl;
  replayHeaders:{referer?;origin?;cookie?;userAgent?}; segmentOrigin?; isMaster?; createdAt }
```
Replay model: from the player you can't set forbidden headers → register a DNR `modifyHeaders`
session rule scoped to the player tab re-applying captured referer/origin (ride the user's cookies
via the jar). See §6.

## 3. Service-worker lifecycle survival
SW dies after 30s idle / >5min task / >30s fetch; **globals are lost on shutdown.**
- **Gotcha 1 — register listeners synchronously at top level.** Chrome only delivers the wakeup
  event if the matching listener registered during the synchronous top-level run. Registering inside
  a promise / `onStartup` body / after `await` **drops** the event that respawned the SW. (#1 cause
  of "works until idle, then misses streams.") Do **not** re-register webRequest in
  `onStartup`/`onInstalled` — top-level registration *is* the re-registration (the file re-executes).
- **Gotcha 2 — write-through to `chrome.storage.session` on every capture** (the in-memory Map is
  just a warm cache; SW can die between two segments). Use **session** (not local) for captured
  cookie/referer — sensitive + ephemeral. puemos' `store.subscribe → storage.local` rehydrate
  pattern is good for *config*, not cookies.
- **Gotcha 3 — danger window** = between detection and the user clicking play; the moment you detect,
  write to session + set the badge (both are events that also keep the SW briefly alive).
- **Gotcha 4 — `extraHeaders` hurts perf** → scope its `urls` filter tightly, never on `<all_urls>`.

## 4. Multi-stream handling (master vs variant vs ad)
Dedupe identity = URL+host+search (cat-catch bypasses complex dedupe past 500 items/tab); also
content-hash blob manifests. **Master vs media — fetch + sniff body:** `#EXT-X-STREAM-INF` ⇒ master
(hand to hls.js for ABR); `#EXTINF` ⇒ media/variant; both ⇒ malformed→media. **Ad/preview
discrimination:** prefer the manifest the main video iframe requested first; domain blocklist
(doubleclick/googlesyndication/imasdk/ads/moatads); ad pods are short VOD with
`#EXT-X-DISCONTINUITY`; real live feed = no `#EXT-X-ENDLIST`, sliding window; master with most
`#EXT-X-STREAM-INF` = real content. Score: `isMaster*100 + variantCount*5 − adDomain*100 −
(hasEndlist&&dur<90)*50 + matchesMainFrame*30`.

## 5. SW → player/popup messaging
**Storage = source of truth, messaging = change-notification.** Popup reads `storage.session.get()`
on open (catches past captures) + subscribes to `storage.session.onChanged` for live updates;
one-shot commands via `runtime.sendMessage`. Avoid long-lived `connect` ports as primary (keeps SW
alive, masks lifecycle bugs); use ports only for streaming progress.

## 6. Header replay (the missing half)
From the player, JS `fetch` can't set Referer/Origin/Cookie → DNR `modifyHeaders` **session rule**
scoped `tabIds:[playerTabId]`, `requestDomains:[manifestHost,segmentHost]`,
`resourceTypes:["xmlhttprequest","media","sub_frame"]`. `tabIds` is session-rules-only. Cookies
replay automatically via same-jar. Chrome-only; Firefox uses blocking webRequest.

## Edge cases that WILL fail
1. `Authorization`-token streams (Chrome blanks it). 2. DRM/EME. 3. Pure MSE with no manifest
(L3 salvages bytes, not playable). 4. Short-lived signed segment URLs (403 by play time).
5. WebRTC/MediaStream sports (not HLS). 6. Sandboxed iframe lacking `allow-scripts` (L2 can't run →
L1-only). 7. CSP `require-trusted-types` breaking MAIN injection / blob minting. 8. Sites that
themselves wrap fetch/JSON.parse or detect non-native `fetch.toString()`. 9. HTTP/3 + byte-range
coalescing (noisier heuristics). 10. blob:-backed-by-blob: pipelines (segment URIs dead outside
original page). 11. The page's *own* Service Worker synthesizing manifests (L2 catches, L1 may not).

## v1 scope
Ship L1 + L2 + write-through session + master/media classify + DNR session-rule replay + popup via
storage+onChanged. Defer L3, DASH, Worker-hook, AES-key sniffing.

## Reference files
cat-catch: `catch-script/search.js`, `catch-script/catch.js`, `js/background.js`. puemos:
`src/background/src/listeners/addPlaylistListener.ts`, `persistState.ts`, `blocklist.ts`, `index.ts`.

## Sources
developer.chrome.com (webRequest, service-workers/lifecycle, declarativeNetRequest, content-scripts)
· deepwiki.com/xifangczy/cat-catch · github.com/{xifangczy/cat-catch, puemos/hls-downloader}.
