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

### D12 — Scaffold donors: keep WXT, pull in specific MIT/Apache building blocks
**Decision:** Don't adopt any boilerplate wholesale. Keep the WXT scaffold and pull in:
**media-chrome** (MIT) for the player controls + quality selector; **@wxt-dev/auto-icons** (MIT,
replaces the placeholder `gen-icons.mjs`); **@wxt-dev/i18n** + built-in **wxt/storage**; copy
detection/parsing from **puemos/hls-downloader** (MIT, Phase 1) and the **hls.js `/demo`** (Apache)
quality-wiring; copy the **wxt-examples** messaging + Vitest patterns (Phase 1/6).
**Why:** every full boilerplate is a worse fit — the flagship React one (Jonghakseo, 4.9k★) is
**archived (Feb 2026)**, others are React/Vue, and Plasmo/extension.js are competing frameworks, not
donors. Switching costs more than it saves.
**Rejected:** migrating to Plasmo/extension.js; porting the Angular (`nas-extension`) or jQuery
(`ghouet/chrome-hls`) player pages (media-chrome replaces them); `webext-bridge` (prefer
`@webext-core/messaging`); a React monorepo boilerplate. See [research/11-scaffold-donors.md](research/11-scaffold-donors.md).

### D11 — Documented hard limits
DRM (Widevine/FairPlay/PlayReady) impossible (sandboxed CDM). CDNs validating `Origin`/
`Sec-Fetch-*` reject in-browser playback (unforgeable headers) → native-mpv handoff is the
Phase 8 recovery. `Authorization` is never exposed to webRequest → token-in-Authorization
streams unrecoverable. Token-expiring segment URLs die on expiry.

---

## Build-phase decisions (Phases 5–7)

### D13 — hls.js on the main thread; rely on MV3's default CSP (supersedes the worker note in D5)
**Decision:** Set `enableWorker: false` and ship **no custom `content_security_policy`**.
**Why:** D5 assumed we'd add `worker-src 'self' blob:` to run hls.js's demuxer in a Web Worker. In
practice MV3's *default* CSP (`script-src 'self'; object-src 'self'`) already blocks the blob worker
**and** enforces no-remote-code for free — and adding *any* custom `extension_pages` CSP trips
web-ext's `MANIFEST_CSP` ("needs additional review") flag, which is exactly the reviewer friction to
avoid on a legally-sensitive extension. The worker is a marginal perf gain for ≤1080p sports;
main-thread demux is deterministic (no silent worker-blocked fallback + console error). No-remote-code
is still enforced explicitly by `scripts/audit-no-remote-code.mjs`.
**Rejected:** custom CSP with `worker-src blob:` (the D5 plan) — review friction > worker benefit.

### D14 — Firefox `strict_min_version` 140 (desktop) / 142 (Android)
**Decision:** Floor at FF 140 desktop / 142 Android (via `gecko` + `gecko_android`).
**Why:** AMO requires the `data_collection_permissions` manifest key for new add-ons, and Firefox
only *honors* that key from 140/142 — declaring a lower minimum means the key is silently ignored
there (`web-ext lint` warns). Aligning the floors keeps the manifest internally consistent and the
lint clean (0 errors; the only warnings left are bundled media-chrome `innerHTML` internals).

### D15 — Test & gate suite; pure-logic extraction for testability
**Decision:** Gates = `tsc` (strict) · ESLint (src-scoped, security rules only: no-eval/no-new-func/
no-unsanitized) · vitest (pure core) · bundle budget · no-remote-code audit · `web-ext lint`, all
behind `pnpm check`. To unit-test without DOM/hls.js/browser imports, extract pure logic into small
modules: `makeLive` → `player/live-playlist.ts`, `upsertHeader` → `header-injector/merge.ts`.
**Why:** The detection/dedupe/ranking + live-ify heuristic + header merge are the bug-prone IP and
are pure → cheap, fast, deterministic tests. The bundle budget specifically guards the *real*
regression (hls.js leaking into the eagerly-loaded background/popup); the lazy player chunk is
allowed to be large. ESLint stays security-only to avoid style-rule noise (tsc covers types).
**Rejected:** full typescript-eslint recommended (noisy); jsdom-env tests that import hls.js (slow,
unnecessary after the extraction); a tight raw-KB budget on the player chunk (it's lazy — D5).

### D16 — Tag-driven release; per-store publish gated on secrets
**Decision:** `release.yml` triggers on a `v*` tag: always builds+zips all three targets, attests
provenance, and cuts a GitHub Release; Chrome/Edge/AMO publish steps each run **only if** their
secrets are set. Version via `npm version` (stamps `package.json`; WXT propagates to every manifest).
**Why:** A solo project doesn't need release-please's PR machinery; tag-driven is simpler and fully
functional. Gating publish on secrets means the pipeline is safe to run before any store account
exists (you just get the GitHub Release + power-user "load unpacked" / signed `.xpi`).
**Rejected:** release-please (extra moving part, untestable without a remote); unconditional store
steps (would fail the job before stores are set up).

---

## Audit-remediation decisions (Phases A–G)

### D17 — Header injection scoped to the granted CDN hosts
**Decision:** `HeaderInjector.apply(tabId, headers, hosts)` — Chrome adds `condition.requestDomains`,
Firefox filters the request host in `onBeforeSendHeaders`.
**Why:** The original rule was tab-scoped only, so the injected `Referer` rode along to **any** host a
(possibly malicious) playlist referenced — a referer-leak channel that would become a cookie-exfil
channel the moment Cookie capture landed. Scoping to the hosts the user granted (`uniqueOrigins`)
keeps multi-host failover working while bounding leakage. Supersedes chrome.ts's old "unscoped on
purpose" comment. **Also:** `reconcile(liveTabIds)` drops rules for dead tabs on SW restart, and a
player tab navigating away clears its rule (no stale Cookie/Referer in a reused tab id).

### D18 — Passive capture via onSendHeaders, re-armed on permission grant
**Decision:** Passive detection uses `webRequest.onSendHeaders` (+ `extraHeaders` on Chrome) and is
re-registered on `permissions.onAdded`/`onRemoved`.
**Why:** `onBeforeRequest` (the original) can't read request headers, so passive mode captured none
(it claimed to). And a webRequest listener registered before a runtime host grant won't retroactively
match the newly-granted hosts on Chrome — so the feature was dead until the SW respawned. Re-arming
makes the "auto-detect on all sites" toggle actually work and capture real Referer/Cookie/UA.

### D19 — Deep capture: runtime-registered MAIN + ISOLATED content scripts, gated on the all-sites grant
**Decision:** A MAIN-world fetch/XHR hook (`deep-main.content.ts`) + an ISOLATED relay
(`deep-relay.content.ts`), both `registration: 'runtime'` with `matches: []`, registered by the
background via `scripting.registerContentScripts` **only while `<all_urls>` is granted**.
**Why:** Catches blob/obfuscated/JSON-embedded `.m3u8` the DOM/Performance scan misses. Static
`matches` would hoist `<all_urls>` into `host_permissions` → the scary install warning we avoid (D6);
runtime registration with empty entrypoint matches keeps `host_permissions: []`. MAIN-world content
scripts are Chromium-only → Firefox no-op. The background validates every `CONTENT_STREAM` URL (the
sender is a page-world hook), and sensitive messages remain extension-page-gated (B4).
**Rejected:** declarative content scripts (install warning); `web_accessible_resources` injection
(would trip the no-WAR safety guard, B5); on-demand `executeScript` (misses document_start fetches).

### D20 — i18n via the platform _locales API (not @wxt-dev/i18n)
**Decision:** `public/_locales/{en,es,pt}/messages.json` + `browser.i18n.getMessage` (tiny `t()`
helper); manifest `name`/`description` via `__MSG_*__` + `default_locale`.
**Why:** Zero new dependency, canonical, and localizes the store-facing name/description (the
highest-reach win). publicDir is the project-root `public/` (not `<srcDir>/public`).
