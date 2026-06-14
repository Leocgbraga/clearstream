# Research 02 — MV3 capture + DNR header-rewrite + hls.js playback recipe (and hard limits)

> Verbatim research report. The precise, current MV3 cross-browser recipe for detecting HLS and
> playing it in a clean hls.js player, plus an honest list of what won't work.

## 1. Detecting the .m3u8 request in MV3 (observation-mode webRequest)
Non-blocking `webRequest` observation is **fully supported in MV3** for all extensions — only
*blocking* (`webRequestBlocking`) was removed. `onBeforeRequest`, `onBeforeSendHeaders`,
`onSendHeaders`, `onCompleted` all work for observation.

Permissions: `"permissions":["webRequest"]` + `host_permissions` covering the CDN domains
(else the listener fires but gets no header data for those origins).

```js
chrome.webRequest.onBeforeRequest.addListener(
  (d) => { if (d.url.includes('.m3u8')) chrome.storage.session.set({ lastM3u8: {url:d.url, tabId:d.tabId} }); },
  { urls: ["<all_urls>"], types: ["xmlhttprequest","media","other"] }   // no 'blocking'
);
```
Capture Referer/Cookie/Origin requires `'extraHeaders'`; without it Chrome hides Referer, Cookie,
Accept-Language/Encoding, Origin. **`Authorization` is never available even with `extraHeaders`.**
`User-Agent` is available without it.
```js
chrome.webRequest.onBeforeSendHeaders.addListener(handler,
  { urls:["<all_urls>"] }, ['requestHeaders','extraHeaders']);
```
Listener must live in the SW and re-register on each spawn (top-level). Persist state to
`storage.session` immediately.

## 2. Header rewriting with declarativeNetRequest
`modifyHeaders` supports `set`/`append`/`remove`. `append` has a restricted allowlist; **`set`/
`remove` work on a broad set**.
- **Referer:** `set`/`remove` work (not on `append`'s list). A known DevTools display bug shows
  the rule as not-applied even when it is.
- **Origin:** the hard limit — security-sensitive, **cannot be modified** (browser/CORS-enforced).
- **Cookie:** on the `append` allowlist; `set` also works; browser jar cookies still attach.
- **User-Agent:** allowlisted; `set`/`remove` work.

```js
chrome.declarativeNetRequest.updateDynamicRules({
  addRules: [{ id:1001, priority:1,
    action:{ type:"modifyHeaders", requestHeaders:[
      {header:"Referer", operation:"set", value:"https://site/"},
      {header:"Cookie",  operation:"set", value:"..."} ]},
    condition:{ urlFilter:"*.cdn.com/*", requestDomains:["cdn.com"],
                resourceTypes:["xmlhttprequest","media","other"] } }],
  removeRuleIds:[1001]
});
```
`requestDomains` = where the request goes (the CDN). `initiatorDomains` = where it comes from
(use to scope to extension-page-originated requests, but extension origins are awkward here →
prefer session rules with `tabIds`). Firefox fails on `requestDomains`/`domains` DNR conditions.
Limits: 30k safe rules / 5k unsafe — plenty.

## 3. In-browser playback with hls.js
hls.js (v1.6.16) supports VOD & Live. `#EXT-X-ENDLIST` present → VOD (stops polling); absent →
live (keeps polling). The **ENDLIST-strip trick**: fetch the manifest, remove `#EXT-X-ENDLIST`,
feed hls.js. **Limit:** a one-shot Blob URL is static → hls.js re-polls the blob, sees no change,
stalls. True live needs a custom loader that strips ENDLIST on **every** poll.

CORS from extension pages: with `host_permissions` for the origin, an extension page's fetch gets
a **relaxed CORS posture** — it can fetch cross-origin even without `Access-Control-Allow-Origin`.
This lifts hls.js's normal "all HLS resources need CORS headers" requirement.

Cookie via hls.js: cannot `setRequestHeader('Cookie')` (forbidden); use `xhr.withCredentials =
true` / `credentials:'include'` (sends jar cookies) or DNR at the network layer.

## 4. Cross-browser
- **Chrome/Edge (MV3):** no blocking webRequest; DNR for header mods (Referer/Cookie/UA yes,
  Origin no); SW ephemeral; host_permissions → CORS bypass.
- **Firefox (MV2+MV3):** **retains blocking webRequest** → rewrite headers at runtime directly;
  DNR `requestDomains`/`domains` conditions are buggy → route Firefox through blocking webRequest.
- **Safari (MV3 App Extension):** native `<video>` HLS (no hls.js needed); DNR `modifyHeaders`
  added in 17.2 but buggy; no blocking webRequest. Lean on native playback.

| Feature | Chrome/Edge | Firefox | Safari |
|---|---|---|---|
| Observe webRequest | ✓ | ✓ | ✓ |
| Blocking webRequest | ✗ | **✓** | ✗ |
| DNR set Referer | ✓ | partial | buggy |
| DNR set Origin | ✗ | ✗ | ✗ |
| DNR requestDomains | ✓ | **broken** | partial |
| hls.js | ✓ | ✓ | native simpler |
| host_permissions CORS bypass | ✓ | ✓ | ✓ |

## 5. Hard limits — what WON'T work
1. **DRM (Widevine/FairPlay/PlayReady):** completely fails — license server authenticates a
   legitimate CDM; the extension player isn't one; decrypted frames never reach extension-
   reachable memory. Detect via `#EXT-X-KEY METHOD=SAMPLE-AES` with KEYFORMAT referencing
   `com.widevine.alpha`/`com.apple.streamingkeydelivery`/`urn:uuid:`. (Plain AES-128 with a key
   URL is NOT DRM and works.)
2. **Token-expiring segment URLs:** signed query params with short TTL → 403 after expiry; no
   client-side fix.
3. **Per-segment session/IP-bound auth:** replay works if the session cookie is valid via
   `withCredentials`; fails if CDN checks IP/UA of the original session.
4. **Origin-validation CDNs:** can't forge `Origin` → rejected.
5. **`Sec-Fetch-*` fingerprinting:** browser-controlled, unspoofable → extension context revealed.
6. **`Authorization`-token streams:** Chrome blanks `Authorization` → can't capture/replay.

## Manifest recipe (MV3)
```json
{ "manifest_version":3,
  "permissions":["webRequest","declarativeNetRequest","storage","tabs"],
  "host_permissions":["<all_urls>"],
  "background":{"service_worker":"background.js","type":"module"},
  "web_accessible_resources":[{"resources":["player.html","hls.min.js"],"matches":["<all_urls>"]}] }
```
(Prefer scoped/optional host permissions over `<all_urls>` to avoid the scary warning — see
research 09.)

## Sources
developer.chrome.com (webRequest, declarativeNetRequest, migrate/blocking-web-requests) · MDN
(declarativeNetRequest, ModifyHeaderInfo, forbidden_header_name) · github.com/video-dev/hls.js ·
duckduckgo/mv3-compat-tests · mux.com multi-drm · developer.apple.com forums (Safari DNR).
