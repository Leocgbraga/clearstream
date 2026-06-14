# Decisions Log (ADR-style)

Every load-bearing decision, why it was made, and what was rejected. So future-me doesn't
re-litigate settled forks. Evidence lives in [`research/`](research/).

---

### D1 — Form factor: browser extension
**Decision:** Build a browser extension, not a web app or desktop app.
**Why:** Runs in the user's own browser → no Python/mpv install, already past Cloudflare,
carries CDN cookies, and **bypasses CORS** via host permissions.
**Rejected:** *Pure web app* — only ~20–30% of these streams send `access-control-allow-origin: *`;
the rest are CORS/Referer-locked and a web page can't forge those headers, so it would need a
server proxy. *Server-proxy web app* — re-serves copyrighted video (direct infringement, worse
posture), costs sports-video bandwidth, single domain = single seizure target. *Desktop app* —
install friction + it's the ACE-takedown shape. See [04-cors-feasibility](research/04-cors-feasibility.md).

### D2 — Not a hosting portal; no monetization
**Decision:** Neutral per-user ad-stripping player; no ads, no hosted stream directory.
**Why:** Keeps the operator out of the redistributor role. Ads = the PLSA "commercial advantage"
trigger that elevates streaming infringement to a felony; reputable ad networks ban piracy sites
anyway (only malvertising networks pay → the exact scumminess being avoided).
**Rejected:** monetized destination site; bundled "what's live" aggregator (gets pulled from
stores as piracy facilitation). See [03-distribution-policy](research/03-distribution-policy.md).

### D3 — Framework: WXT
**Decision:** WXT (Vite-based) + vanilla TypeScript.
**Why:** Only actively-maintained framework that outputs Chrome+FF+Edge from one codebase and
auto-resolves the SW-vs-event-page manifest split; tree-shakes; `browser` shim removes the
polyfill need.
**Rejected:** Plasmo (Parcel-based, maintenance limbo); CRXJS (Chromium-only, can't make
Firefox/AMO packages); plain Vite/vanilla (you hand-roll the cross-browser manifest plumbing).
See [05-scaffolding-tooling](research/05-scaffolding-tooling.md).

### D4 — Scratch, not fork
**Decision:** Scaffold fresh; port detection logic from our own `extractor.py`; mine
`puemos/hls-downloader` (MIT) for DNR/sniffing patterns.
**Why:** Every fork candidate is wrong-license, wrong-stack, or download-centric.
**Rejected:** fork `cat-catch` (GPL-3.0 → would force GPL; jQuery monolith); fork
`nas-extension` (stale/Angular, redirects to external player); fork `puemos/hls-downloader`
(Redux + styled-components + download pipeline = rip out more than you keep).

### D5 — hls.js: FULL build, bundled, pinned
**Decision:** Full `hls.min.js`, pinned `1.6.16`, vendored into the package.
**Why:** Sports streams carry alt-audio renditions the **light** build drops; local bundle means
the ~20 KB size delta is irrelevant. Bundling (no CDN `<script>`) is required by store
no-remote-code rules.
**Rejected:** `hls.light.mjs` (the scaffolding pass suggested it for size; the player deep-dive
overrode on functional grounds). `enableWorker` needs `worker-src 'self' blob:` in the page CSP.
See [07-player-engine](research/07-player-engine.md).

### D6 — Permission model: empty host_permissions + DNR detection + optional per-CDN grant
**Decision:** Install with `host_permissions: []`. Detect via `declarativeNetRequest` (silent,
no warning). Request the one CDN host at the "Watch" click.
**Why:** `activeTab`+webRequest can't even see the cross-iframe CDN streams these sites use (and
is absent on Firefox); DNR matches all frames with zero host permission and zero install warning.
The granted host then also satisfies the CORS bypass + header injection for playback.
**Rejected:** `<all_urls>` at install (scary warning, #1 abandonment cause + review flag).
See [09-ux-permissions](research/09-ux-permissions.md).

### D7 — Header injection: Chrome DNR (session, tabId-scoped) / Firefox blocking webRequest
**Decision:** One `HeaderInjector` interface, two build-time backends. Chrome uses DNR session
rules scoped `tabIds:[playerTabId]`; Firefox uses blocking `webRequest.onBeforeSendHeaders`.
**Why:** Firefox's DNR domain conditions (`requestDomains`/`initiatorDomains`) are broken (per
DuckDuckGo's mv3-compat-tests); FF retains blocking webRequest in MV3. `tabIds` session-rule
scoping is precise and dodges the opaque-initiator bug that plagues `initiatorDomains`.
**Rejected:** `initiatorDomains:[runtime.id]` as primary (opaque-initiator edge cases); exposing
`Origin` in the interface (Chrome can't reliably set it → backends would diverge).
See [08-cross-browser](research/08-cross-browser.md), [07-player-engine](research/07-player-engine.md).

### D8 — ENDLIST live-ify: custom pLoader, not a one-shot blob
**Decision:** A custom hls.js `pLoader` that strips `#EXT-X-ENDLIST`/`PLAYLIST-TYPE:VOD` on
**every** manifest+level poll, guarded by a media-sequence liveness check.
**Why:** A one-shot blob is immutable → hls.js re-polls it, sees no new segments, and stalls
after the first window. The rewrite must run on each poll, inside hls.js's own loop.
**Rejected:** one-shot blob (stalls); service-worker fetch-intercept as primary (MV3 SW dies
after ~30s idle → drops mid-match; fine as a Firefox/native fallback only).
See [07-player-engine](research/07-player-engine.md).

### D9 — Force MV3 everywhere; no webextension-polyfill
**Decision:** MV3 on Chrome, Edge, and Firefox; use WXT's `browser` import.
**Why:** Modern manifest + (on Firefox) retained blocking webRequest; MV3 Chromium already
returns promises so the polyfill is unneeded.

### D10 — Distribution: AMO + Chrome + Edge + GitHub `.xpi`, "detector & player" framing
**Decision:** Publish to Firefox AMO (most permissive), Chrome Web Store + Edge (framed as a
Developer-Tools "HLS Stream Detector & Player," explicit no-YouTube/no-DRM, privacy + disclaimer),
and GitHub (open-source home + signed `.xpi` one-click for Firefox).
**Why:** Stores pull "downloader/ripper"/piracy framing but keep the same tech as a
detector/player; Chrome blocks sideloaded `.crx` so GitHub is power-user-only on Chrome.
See [03-distribution-policy](research/03-distribution-policy.md).

### D11 — Documented hard limits
DRM (Widevine/FairPlay/PlayReady) impossible (sandboxed CDM). CDNs validating `Origin`/
`Sec-Fetch-*` reject in-browser playback (unforgeable headers) → native-mpv handoff is the
Phase 8 recovery. `Authorization` is never exposed to webRequest → token-in-Authorization
streams unrecoverable. Token-expiring segment URLs die on expiry.
