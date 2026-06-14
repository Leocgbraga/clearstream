# ClearStream — Architecture & Production Plan

> The synthesized architecture, distilled from the 10 research passes in [`research/`](research/).
> This is the actionable blueprint; the research files hold the evidence and source URLs.

## 1. Context

A personal Python/Playwright/mpv tool captures the `.m3u8` behind ad-infested stream pages and
plays it cleanly, but needs Python + mpv + an LLM agent to run — not shippable to normal people.

**Goal:** let the largest number of people watch these streams **without ad/popup disruptions** —
free, no LLM, no server, and *without operating an infringing portal*.

**Why a browser extension (not a web app):** it runs in the user's own browser → no install of
Python/mpv, already past Cloudflare, carries CDN cookies natively, and **bypasses CORS**. A pure
web app can't: only ~20–30% of these streams are CORS-open; the rest need a server proxy =
redistribution risk + bandwidth bill (see [04-cors-feasibility](research/04-cors-feasibility.md)).

**Posture:** a neutral per-user ad-stripping media player, not a website that serves/embeds
streams. No monetization (avoids the felony "commercial advantage" trigger). Reactive only (no
bundled pirate-link directory — that framing gets pulled from stores).

## 2. Scope

**v1 is:** reactive HLS/DASH detector on the active tab · clean bundled hls.js player · header
injection (Referer/Cookie/UA) · multi-stream auto-failover · cross-browser (Chrome/Edge/Firefox)
· minimal permissions · zero telemetry.

**v1 is not:** download-to-disk headline · DRM playback · a "what's live" directory · any
server/analytics/accounts.

**Hard limits (state honestly):** DRM (Widevine/FairPlay/PlayReady) impossible in-extension
(sandboxed CDM) → unprotected/free HLS only, not Paramount+/FOX. CDNs validating `Origin`/
`Sec-Fetch-*` (unforgeable) reject in-browser playback → the minority the Python+mpv tool beats;
mitigation = optional native-mpv handoff (Phase 8). Token-expiring segment URLs die on expiry.

## 3. Tech stack

| Choice | Decision | Why |
|---|---|---|
| Framework | **WXT** (Vite-based) | Builds Chrome+FF+Edge from one codebase; auto-resolves SW-vs-event-page manifest split; tree-shakes; first-class TS. Plasmo in maintenance limbo; CRXJS Chromium-only. |
| Language | **TypeScript** (`strict`) | Detection/dedupe/failover are pure, unit-testable. |
| UI | **Vanilla TS** (no framework v1) | Popup = list + button; player = `<video>`. Svelte later if needed. |
| Player | **hls.js**, pinned `1.6.16`, **full build**, bundled | Sports streams carry alt-audio the light build drops; local bundle → size irrelevant. `enableWorker` needs `worker-src 'self' blob:` in CSP. |
| Player UI | **media-chrome** (MIT) | Web-component controls + **`<media-rendition-menu>` quality selector** wired to `hls.levels`; bundled (no remote code). Replaces hand-written controls. |
| Icons | **@wxt-dev/auto-icons** (MIT) | One source `src/assets/icon.png` → all manifest sizes at build. |
| API | WXT `browser` import, **no webextension-polyfill** | MV3 Chromium returns promises; WXT shim covers the namespace. |
| Base | **Scratch, not fork** | Port detection from `Stream/stream/extractor.py`; mine `puemos/hls-downloader` (MIT) for patterns; cat-catch GPL → patterns-only. |
| License | **MIT** | Keep the stack permissive. |

## 4. Directory structure

```
clearstream/
├─ .github/workflows/{ci.yml, release.yml}
├─ wxt.config.ts                    # per-browser manifest (function form)
├─ package.json  tsconfig.json  pnpm-lock.yaml
├─ LICENSE (MIT)  README.md  PRIVACY.md
├─ docs/                            # THIS knowledge base
├─ src/
│  ├─ entrypoints/
│  │  ├─ background.ts              # SW (Chrome) | event page (FF): detection, badge, capture, routing
│  │  ├─ popup/{index.html,main.ts} # detected-streams list → one-click Watch
│  │  ├─ player/{index.html,main.ts}# clean hls.js player (unlisted, extension-origin)
│  │  └─ content.ts                 # (Phase 8) deep fetch/XHR + MediaSource capture
│  ├─ core/
│  │  ├─ detection.ts               # detect + dedupe + master-vs-variant rank (port extractor.py)
│  │  ├─ header-injector/{types,index,dnr.chromium,webrequest.firefox}.ts
│  │  ├─ player/{hls-controller,endlist-loader,failover}.ts
│  │  ├─ permissions.ts  storage.ts  types.ts
│  ├─ assets/  public/{icons,_locales/en}
├─ tests/{unit (vitest), e2e (playwright)}
└─ store/{chrome,firefox,edge}      # listing copy + screenshots
```

The **player page is an unlisted extension page** — an extension-origin page with host
permission bypasses CORS, the keystone that lets hls.js fetch manifest+segments directly.

## 5. Architecture detail

### 5.1 Permission model (minimal install footprint)
Install with **empty `host_permissions`** → no scary warning.
- **Detection = `declarativeNetRequest`** rule matching `*.m3u8/*.mpd` → per-tab badge. Matches
  in-browser without reading the request → no host permission, no warning, sees all frames
  (where `activeTab`+webRequest is blind / FF-absent).
- **Playback = optional host permission per-CDN**, requested inside the "Watch" click via
  `permissions.request({origins:[cdnOrigin]})`; persisted, revocable.
- **Stubborn pages:** "Scan this page" uses `activeTab`+`scripting` to read `<video>/<source>`/
  inline `.m3u8` — gesture-scoped, no warning.
- Perms: `["declarativeNetRequest","storage","activeTab","scripting"]` +
  `optional_host_permissions:["*://*/*"]`, `host_permissions:[]`.
- **Phase-1 spike:** confirm low-permission detection on Firefox (FF DNR domain conds are buggy;
  plain regex match may suffice, else webRequest observation with optional host perms).

### 5.2 Capture engine
Layered (one layer caps ~70% on hostile sites):
- **L1 (core):** `webRequest` observation — `onSendHeaders` on `*.m3u8` + `onHeadersReceived`
  content-type net (`mpegurl`) for extensionless manifests; capture headers with
  `['requestHeaders','extraHeaders']`. **`Authorization` never exposed** → those streams lost.
- **L2 (differentiator):** dual content-script — MAIN-world hook (`world:"MAIN"`,
  `document_start`, `all_frames`, `match_origin_as_fallback`) patching
  `fetch`/`XHR`/`JSON.parse`/`TextDecoder` for blob/obfuscated/JSON-embedded manifests → relay
  via `postMessage` to ISOLATED script → SW.
- **L3 (later):** `MediaSource.appendBuffer` capture (download-only, defer).
- Dedupe by `{host+path}` (+content-hash for blobs). Classify by body sniff
  (`#EXT-X-STREAM-INF`→master, `#EXTINF`→media). Rank master > media > ad-stub. Write-through to
  `storage.session` on every capture; register listeners synchronously at top level.

### 5.3 Header injection (one interface, two backends)
`interface HeaderInjector { setRules; removeRule; clear }`
- **Chrome/Edge:** DNR dynamic/session `modifyHeaders` (`set` Referer/Cookie/UA), scoped
  `tabIds:[playerTabId]` (session rules) — cleaner than `initiatorDomains`, dodges opaque-initiator bug.
- **Firefox:** blocking `webRequest.onBeforeSendHeaders` (FF DNR domain conditions are broken;
  FF retains blocking webRequest in MV3).
- Build-time branch via `import.meta.env.FIREFOX` (tree-shaken). **`Origin` omitted** (Chrome
  can't set it). Cookies often "just work" via `credentials:'include'`.

### 5.4 Player engine
- Full hls.js → `<video>`; Safari branch = native `<video src=m3u8>` (no loader hook there).
  Tuned: `lowLatencyMode:false`, raised retries, `capLevelToPlayerSize:true`, dynamic
  `liveDurationInfinity`.
- **ENDLIST live-ify via custom `pLoader`** (NOT a one-shot blob — blobs are immutable → stall).
  Wrap `onSuccess` for `context.type` `'manifest'` AND `'level'`; strip `#EXT-X-ENDLIST`/
  `PLAYLIST-TYPE:VOD` every poll; guard with media-sequence liveness check.
- Header injection: cookies via `credentials:'include'`; Referer/UA via session DNR rule /
  FF webRequest. `Origin`/`Sec-Fetch-*` unforgeable → Origin-pinned CDNs unplayable.
- **Failover** (port of `player.py`): healthy = `FRAG_LOADED` + advancing `currentTime`;
  `DEGRADED_STREAK=5`, `MIN_PLAY_MS=8000` anti-flap; fatal → `startLoad()`/`recoverMediaError()`
  then advance; progress watchdog (frozen ~8s) → failover; ARIA-live "why" strip + manual pin.
- UX: quality selector, fullscreen, PiP, keyboard, volume memory, dark UI, "Go Live",
  remembered working Referer per CDN in `storage.local`.

### 5.5 Cross-browser
WXT `browser` everywhere; force MV3 on all; per-browser manifest via `wxt.config.ts` function
(`gecko.id`, `strict_min_version`). Chromium build drop-in for Edge/Brave/Opera/Vivaldi. Safari
= later converted target.

## 6. Phased roadmap

- **Phase 0 — Repo, docs & scaffold** *(1d)*: repo + this `docs/` + `wxt init` + CI skeleton.
- **Phase 1 — Capture + permission core** *(3d)*: DNR detection + badge + popup; optional-host Watch; header capture; FF detection spike.
- **Phase 2 — Clean player** *(3d)*: hls.js page; `pLoader` ENDLIST; controls; Safari native branch.
- **Phase 3 — Header injection across CDNs** *(2d)*: both backends; verify on a Referer-gated stream.
- **Phase 4 — Failover + intelligence** *(4d)*: ranking, auto-pick, failover, Referer memory, quality, keyboard, dark.
- **Phase 5 — Cross-browser parity** *(2d)*: FF MV3, per-browser manifests, Edge.
- **Phase 6 — Hardening/perf/tests** *(4d)*: no-remote-code, CSP, XSS-safe, bundle budget, vitest + Playwright + web-ext lint.
- **Phase 7 — Release + store submission** *(3d)*: tri-store publish + signed `.xpi` + GitHub Release + provenance.
- **Phase 8 — Post-launch** *(backlog)*: deep-capture content script; native-mpv handoff; Safari; i18n.

## 7–11. Testing, CI/CD, distribution, risks, verification
See [10-security-testing-release](research/10-security-testing-release.md) for the full testing
strategy and the tri-store GitHub Actions pipeline; [03-distribution-policy](research/03-distribution-policy.md)
for channel ranking and survivable framing. End-to-end verification per phase: load unpacked →
Mux test stream → live aggregator → Referer-gated stream → multi-mirror failover.
