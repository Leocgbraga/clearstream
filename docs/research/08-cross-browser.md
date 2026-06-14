# Research 08 — Cross-browser single-codebase strategy

> Verbatim research report. **Use WXT.** One codebase, MV3 everywhere (incl. Firefox — for the
> modern manifest + FF's retained blocking webRequest), `browser` export = no webextension-polyfill.
> Decisive finding: **Firefox's DNR domain-matching is broken** (`requestDomains`/`initiatorDomains`/
> `domains` fail in DuckDuckGo's compat suite while passing on Chrome). Since header injection must
> be host-scoped, Firefox routes through blocking webRequest instead — strictly better there.

## 1. One header-injection abstraction, two backends
```ts
// core/header-injector/types.ts
export interface HeaderOverrides { referer?:string; cookie?:string; userAgent?:string; } // Origin deliberately omitted
export interface HeaderRule { id:number; host:string; overrides:HeaderOverrides; }
export interface HeaderInjector {
  setRules(r:HeaderRule[]):Promise<void>; removeRule(id:number):Promise<void>; clear():Promise<void>; }
```
Factory — **build-time branch** so the unused backend is tree-shaken:
```ts
export function createHeaderInjector():HeaderInjector {
  if (import.meta.env.FIREFOX) { const {WebRequestInjector}=require('./webrequest.firefox'); return new WebRequestInjector(); }
  const {DnrInjector}=require('./dnr.chromium'); return new DnrInjector();
}
```
**Chromium (DNR):** dynamic rules; `set` referer/cookie/user-agent; `condition.requestDomains:[host]`
(works on Chromium), `resourceTypes:['xmlhttprequest','media','other']`. Use **dynamic** rules
(hosts discovered at runtime); ceilings huge.
**Firefox (blocking webRequest):** `onBeforeSendHeaders` with `['blocking','requestHeaders']`, own
`hostMatches(url,host)`, upsert referer/cookie/user-agent. FF's broken DNR domain conditions never
enter the picture.

**Build-time vs runtime:** anything that changes API surface/permissions → build-time
(`import.meta.env.FIREFOX/.CHROME`); runtime checks (`import.meta.env.BROWSER`) only for pure-JS nits.
**Origin caveat:** omit from the public interface (Chrome can't reliably `set` Origin; FF could →
backends would diverge; many Origin-gated CDNs reject extensions anyway). `append` allowlist is a
red herring — you use `set`.

## 2. Manifest differences (per-browser emission)
WXT `manifest` can be a **function** receiving `{browser, manifestVersion, ...}`:
```ts
export default defineConfig({ manifestVersion:3, manifest:({browser})=>{
  const ff = browser==='firefox';
  const base = { name:'HLS Player', host_permissions:['<all_urls>'],   // (research 09: prefer empty + optional)
    web_accessible_resources:[{resources:['player.html'],matches:['<all_urls>']}] };
  if (ff) return {...base, permissions:['storage','tabs','webRequest','webRequestBlocking'],
    browser_specific_settings:{ gecko:{ id:'hls-player@yourdomain.dev', strict_min_version:'128.0',
      data_collection_permissions:{required:['none']} } }};
  return {...base, permissions:['storage','tabs','declarativeNetRequest','declarativeNetRequestWithHostAccess']};
}});
```
**WXT automates:** background key (one `background.ts` → `service_worker` on Chromium /
`background.scripts` event page on Firefox); manifest version per target (override to force MV3 on
FF); per-browser permissions (you supply valid deltas); `declarative_net_request` key only if you add
static rulesets (we use dynamic only); separate `dist/{chrome,firefox,edge}-mv3/`.

## 3. API namespace + promises
**Use WXT's `browser` import; skip webextension-polyfill.** WXT's `browser` =
`globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome` — native promises on FF,
and MV3 Chromium already returns promises for the methods we use (storage/tabs/declarativeNetRequest).
Polyfill only needed for raw `chrome.*` + rare callback-only methods; WXT offers an optional
`@wxt-dev/webextension-polyfill` if you ever hit one. Default: don't add it.

## 4. Firefox specifics
- **Add-on id required for MV3 signing** → `browser_specific_settings.gecko.id` (email-style
  `name@domain` recommended, or GUID). Keep it stable forever (update identity).
- `strict_min_version` ≥ a FF with stable MV3 + blocking webRequest (128.0 ESR safe). FF 127+ shows
  `host_permissions` in the install prompt.
- `data_collection_permissions:{required:['none']}` for a no-telemetry tool.
- AMO requires signing; `wxt zip -b firefox` produces the ext zip + a sources zip AMO wants;
  submit via AMO Hub / `web-ext sign`. Self-distribution still needs AMO signing.
- **DNR features to AVOID on FF → blocking webRequest instead:** `requestDomains`,
  `initiatorDomains`, `domains` conditions all **fail** on Firefox (DuckDuckGo mv3-compat-tests);
  `modifyHeaders` itself passes but is useless without host scoping. FF retains `webRequestBlocking`
  in MV3 (Chrome removed it except policy-installed) → fully sanctioned path.

## 5. Edge + Chromium cousins
Chrome build is **drop-in** for Edge/Brave/Opera/Vivaldi/Arc (same `chrome.*`, same DNR behavior incl.
correct `requestDomains`). Publish the same package to the Edge store for discoverability
(`wxt build -b edge` is byte-compatible). Brave Shields can interfere with network requests — test.
Cousins pull Chromium security fixes within ~48h → DNR stays in lockstep. **One Chromium build.**

## 6. Safari (later)
`xcrun safari-web-extension-converter ./dist/chrome-mv3` wraps the MV3 build into an Xcode App-
Extension. **Native `<video>` HLS** is the big advantage (no MSE/hls.js needed) — feature-detect:
```js
if (video.canPlayType('application/vnd.apple.mpegurl')) video.src=url; else if (Hls.isSupported()) {/*hls.js*/}
```
Header-injection limits remain: Safari DNR `modifyHeaders` is buggy/partial, **rejects unrecognized
header names**, no blocking webRequest fallback → treat Safari as a **third backend**, validate each
header empirically (native playback often works without rewriting since Safari sends credible
Origin/Referer). Distribution: Xcode + Apple Developer $99/yr + notarization (the cost, not the code).

## Final architecture
```
wxt.config.ts → per-browser manifest (function form)
src/entrypoints/{background.ts, player/, content.ts}
src/core/header-injector/{types.ts, index.ts (build-time branch), dnr.chromium.ts,
  webrequest.firefox.ts, (later) dnr.safari.ts}
```
One interface, backends selected at build time + tree-shaken. Chromium family = one build. Firefox =
MV3 + blocking webRequest (sidesteps broken DNR domain matching). Safari later via native HLS + a
Safari DNR backend. No webextension-polyfill.

## Sources
MDN (declarativeNetRequest, ModifyHeaderInfo, RuleCondition, webRequest.onBeforeSendHeaders,
permissions, browser_specific_settings) · developer.chrome.com declarativeNetRequest ·
w3c/webextensions issue #372 (DNR supported-headers) · github.com/duckduckgo/mv3-compat-tests ·
blog.mozilla.org FF MV3 · wxt.dev (target-different-browsers, config/manifest, extension-apis) ·
npmjs/github webextension-polyfill · developer.apple.com forums 760969/733791 · evilmartians.com Safari conversion.
