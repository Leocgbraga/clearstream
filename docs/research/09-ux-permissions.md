# Research 09 — Intelligent UX & minimal-permission model

> Verbatim research report. **The finding that reshapes the design:** `activeTab`+webRequest only
> sees the tab's *main-frame* origin (and gives no webRequest at all on Firefox). On these sites the
> m3u8 loads from a CDN inside a cross-origin iframe → `activeTab`+webRequest sees almost none of
> them. Detection and playback are two different permission problems.

| Job | Mechanism that works | Permission cost |
|---|---|---|
| **Detect** m3u8 across all frames, pre-click, for a badge | `declarativeNetRequest` static rule → bump the action badge | **Zero install warning, zero host permission** |
| **Read** manifest body + segments | `fetch()` from a context with host permission for the CDN | optional host perm, runtime |
| **Inject** Referer/UA/Cookie per segment | hls.js loader + DNR `modifyHeaders` session rule | same optional host perm |

DNR counts matches **without your code reading the request** → no host permission, no warning. That
is the "works automatically, silent install" property.

## 1. Permission model (recommended)
- **`<all_urls>` host_permissions — rejected** (scary "read all your data" warning; #1 abandonment +
  review flag).
- **`activeTab` + click — necessary but insufficient** (main-frame-origin webRequest, FF-absent).
  Keep for the gesture "act on this tab now."
- **`declarativeNetRequest` — the workhorse.** Plain `declarativeNetRequest` for *detection counting*
  (no host access, no warning); `declarativeNetRequestWithHostAccess` for `modifyHeaders` after a host
  is granted.
- **Optional host permissions via `permissions.request()`** for the *playback* path, requested inside
  the "Watch" click (must be a user gesture).
```jsonc
{ "manifest_version":3, "name":"Stream — clean HLS player",
  "permissions":["declarativeNetRequest","storage","activeTab","scripting"],
  "optional_permissions":["tabs"],
  "optional_host_permissions":["*://*/*"],   "host_permissions":[],   // empty → no scary install warning
  "background":{"service_worker":"sw.js","type":"module"},
  "action":{"default_popup":"popup.html"},
  "declarative_net_request":{"rule_resources":[{"id":"detect","enabled":true,"path":"rules/detect.json"}]},
  "minimum_chrome_version":"116" }
```
`rules/detect.json`: regexFilter `\\.m3u8(\\?|$)`, resourceTypes `["xmlhttprequest","media","other","sub_frame"]`,
action `allow` (observe-only; count via the action badge). Install shows essentially no host
warning; detection still runs on every tab (DNR is in-browser); you only prompt at "Watch," naming
the single CDN host.
**Firefox:** prompts for `host_permissions` at install (FF 127+) → reinforces empty + optional;
supports `optional_host_permissions` + DNR; FF `activeTab` gives no webRequest (irrelevant here).
**Downgrade as a feature:** per-site "Always allow on this host" toggle; release the grant with
`permissions.remove()` after the session.

## 2. Detect → watch flow (minimal-click)
SW keeps `Map<tabId, Stream[]>` in `storage.session`. DNR match → increment +
`chrome.action.setBadgeText({tabId, text})` (green). Reset on `webNavigation.onCommitted`. So
**before any click the badge already shows "3"** on a tab with streams — the "it just knows" moment,
zero permissions. **Watch = 2 clicks (often 1):** click action → popup lists detected streams,
best pre-selected "Recommended" → click Watch → `permissions.request({origins:[cdnOrigin]})` →
open player page / Document PiP → hls.js. **Auto-pick ranking:** master>media; previously-worked
host; recency; variant count (`#EXT-X-STREAM-INF`). Show the rest as collapsed "Other sources (N)"
= the failover fallbacks. **"Scan this page"** for lazy players: `chrome.scripting.executeScript`
under `activeTab` to scrape `<video>/<source>`/inline `.m3u8` from DOM + same-origin frames — read-
only, no warning. (Auto-clicking play = opt-in "aggressive mode," later.)

## 3. Auto-failover intelligence (port of player.py + proxy.py)
No local HTTP server in MV3 → **hls.js custom loader** fetches manifest/segments with captured
headers (DNR `modifyHeaders` session rule scoped to CDN host + custom-loader headers for the rest).
**Referer caveat — verified & contested:** `append` excludes `referer` but **`set`/`remove` work on
any header**; the "can't set Referer" myth traces to using `append`, wrong conditions
(`sub_frame` only catches the iframe's first load — use `initiatorDomains:[runtime.id]` +
`xmlhttprequest`), and a devtools display bug. Design loader-first (set on the fetch) with DNR `set`
as enhancer. Cookies: `fetch(url,{credentials:'include'})` with host perm. VOD-stripping: drop
`#EXT-X-ENDLIST` in the loader for the rolling-chunk case (hls.js handles live/VOD natively otherwise).
**Failover state machine** (`DEGRADED_STREAK=5`, `MIN_PLAY_MS=8000`):
```js
hls.on(Hls.Events.FRAG_BUFFERED,()=>errStreak=0);                          // healthy (proxy.py:166)
hls.on(Hls.Events.ERROR,(_e,d)=>{
  if(!d.fatal){ if(d.details?.includes('FRAG')||d.type===Hls.ErrorTypes.NETWORK_ERROR) errStreak++;
    if(errStreak>=DEGRADED_STREAK) return failover('repeated segment errors'); return; }
  switch(d.type){ case NETWORK_ERROR: hls.startLoad(); break;              // try in-place recovery first
    case MEDIA_ERROR: hls.recoverMediaError(); break; default: failover('unrecoverable '+d.details); }});
// stall watchdog: currentTime not advancing ~10s while !paused → failover('stalled')
```
`failover` mirrors `play_multi`: if `<MIN_PLAY_MS` mark "bad capture" (flap guard, player.py:22-24);
`destroy()`; idx++; request host perm for next CDN if different; rebuild. **Surface why** in an
ARIA-live strip ("⟳ Source 1 stalled — switched to Source 2 · [Sources ▾]"), each prior source ✕ +
reason tooltip; manual pin dropdown = escape hatch. Cap `startLoad()` retries before failover.

## 4. Intelligent touches — v1 vs later
**v1:** remembered working Referer/host per CDN (`storage.local` `{host→{referer,ua,lastOk}}`) — best
signal feature; auto-pick + auto-failover; quality selector (default Auto); dark UI
(`prefers-color-scheme`); keyboard (Space/F/M/←→/[ ]); badge + one-click popup.
**Later:** PiP (standard easy; **Document PiP** Chromium-only, more glue → v1.1); i18n scaffolding
(`chrome.i18n` + `_locales/en` from day one, ship `en` only); a11y floor v1 (focus rings, ARIA-live,
`<video>` aria-label, keyboard) + full audit later; "aggressive auto-click" mode (opt-in, later);
"scan all tabs" (needs `tabs`, on demand).

## 5. Privacy posture
**Technical:** no network egress except the stream; CSP `default-src 'self'` blocks third-party
scripts (`connect-src *` only for the stream fetch — justify in review); all state local
(`storage.session` for detections, `storage.local` for the worked-host map + prefs; **no
`storage.sync`**); no identifiers/install-ID.
**Store language:** "Runs entirely on your device. No analytics, no tracking, no accounts, no
servers — never phones home. Requests access to a site only when you click Watch, only for that
video host; revoke anytime. Detected streams live in temporary session storage…" Fill the CWS
privacy form "does not collect user data"; one-line justification per permission (DNR=detect URLs;
activeTab/scripting=scan on request; optional host=play chosen stream; storage=local settings).
Mismatches there are the most common rejection cause.

## Build order
1. DNR detection + per-tab badge + popup (zero-permission core; proves "it just knows").
2. hls.js custom-loader player + `permissions.request` gesture (the proxy.py port).
3. Auto-pick ranking + failover state machine (player.py port).
4. Worked-host map, quality, keyboard, dark, i18n/a11y scaffolding.
5. PiP, scan-all-tabs, opt-in auto-click.
**Validate first:** (a) DNR badge fires on cross-frame CDN manifests (it should; activeTab+webRequest
would not); (b) Referer reaches the CDN via the fetch-loader on a real protected stream.

## Sources
developer.chrome.com (activeTab, permissions, declarativeNetRequest, action, webRequest) ·
bugzilla.mozilla.org 1617479 (activeTab≠webRequest on FF) · chromium-extensions groups (DNR Referer)
· developer.chrome.com web-platform/document-picture-in-picture + MDN · blog.mozilla.org MV3 updates
(FF host-permission prompt) · MDN optional_host_permissions · github.com/54ac/stream-detector · fetchv.net.
