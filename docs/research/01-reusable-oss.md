# Research 01 — Reusable OSS extensions (fork / mine for patterns)

> Verbatim research report. Goal: find existing open-source projects to fork, reuse, or learn
> architecture from for an HLS-detect + in-browser-hls.js-player extension.

## Summary

Two layers: the **capture layer** (detecting the m3u8 URL + request headers) and the **player
layer** (in-browser HLS playback). Ranked shortlist follows the profiles.

## Layer A — Detection / Capture

### 1. xifangczy/cat-catch — GPL-3.0 (v2+; v1 was MIT) — ~20k★ — active (2026) — MV3
Multi-layered capture: passive `webRequest` interception in the SW, a "Deep Search" content
script that proxies `fetch`/`XHR` at runtime, and a "Cache Capture" mode pulling from
`MediaSource` buffers. **Captures headers via `onSendHeaders`** (referer/origin/cookie/
authorization) — most complete header capture reviewed. Has an m3u8 parser UI with AES-128
decryption; dependencies include hls.js, mux.js, mpd-parser. **Best reference for the entire
capture layer**, but GPL-3.0 means a fork must also be GPL-3.0 → use patterns, not code.

### 2. 54ac/stream-detector — MPL-2.0 — 719★ — archived 2023 — MV2
Detects HLS/DASH/HDS/MSS/VTT via passive network monitoring. Assembles ready-made yt-dlp/ffmpeg/
streamlink/N_m3u8DL-RE commands incl. cookies + `--add-header`. Uses
`onBeforeSendHeaders` to capture headers. MPL-2.0 is fork-friendly (file-level copyleft).
Archived + MV2 → port the webRequest listener to MV3. Best reference for the command/header-
assembly pattern.

### 3. puemos/hls-downloader — **MIT** — 2.6k★ — active (2026) — dual MV2/MV3
Automatic HLS detection ("detects playlists the moment you open the page"). MV3 build uses a
background service worker. **No built-in player** — download-focused (merges segments to MP4 via
ffmpeg.wasm in an offscreen document). Clean `background/` + React popup + `core/` Redux store;
TypeScript; dual-manifest build (`MV_TARGET=mv3`). **Best fork/mining candidate (MIT)** — clean
MV3 service-worker structure + detection logic; replace the ffmpeg download with an hls.js player.

### 4. Palethorn/nas-extension — MIT — 32★ — low activity (2024) — MV3
Detects `.m3u8`/`.mpd` via `declarativeNetRequest` regexFilter rules → redirects the tab to a
player page bundling hls.js + dash.js. **No header capture** (DNR is header-blind). Closest
existing architecture to "m3u8 → embedded hls.js player," but needs `webRequest.onSendHeaders`
added for header capture. Small/clean enough to fork directly for the player page.

### 5. kesenek/m3u8-hunter — MIT — MV3
Triple detection (webRequest + DOM scan + Performance API/fetch-XHR monitoring). Good pattern
reference for the layered approach.

### 6. travondatrack/M3U8-Spy — minimal — sniffs `.m3u8` via webRequest, copies to clipboard.
Reference for how few lines basic detection needs.

## Layer B — In-Browser Player (hls.js bundled)

### 7. ghouet/chrome-hls ("Native HLS Playback") — Apache-2.0 — 85★ — stale (2023) — MV2 — 200k store users
Content script intercepts navigation to `.m3u8`, redirects to `player.html` + `player.js`
wrapping hls.js. **Most direct reference for the player layer.** Gap: only catches manually
clicked `.m3u8` links, not silently-loaded URLs. Needs MV3 port. Combine its player UI with
cat-catch/hls-downloader detection backend.

### 8. Palethorn/nas-extension (dual role) — most complete existing MV3 detect-and-redirect →
embedded hls.js player.

### 9. wisniewskit/hlsify — MPL-2.0 — Firefox-first — tiny — navigation intercept → `player.html`
with bundled hls.js. Minimal reference.

### 10. video-dev/hls.js — **Apache-2.0** — 16.7k★ — very active — v1.6.16 (2026)
The player library. Needs MSE (Chrome 47+, FF 51+, Safari 10+). UMD + ESM builds; **light build**
excludes DRM/alt-audio/subtitles. Custom loader via `xhrSetup`/`fetchSetup` for header injection
into segment fetches (but cannot set forbidden headers like Referer). Apache-2.0 → no copyleft.

## Layer C — External Player Handoff (mpv/VLC)

### 11. Baldomo/open-in-mpv — GPL-3.0 — 182★ — active — custom `mpv://` URI + native Go binary.
### 12. Thann/play-with-mpv — Unlicense — 372★ — context menu → local Python daemon via native
messaging; uses yt-dlp.

## Closed-source (study only)
- **FetchV** (fetchv.net) — not OSS, no license — study artifact only.
- **m3u8 Sniffer TV** — no source, 60k users, integrated player — study only.

## The critical MV3 header problem
Chrome refuses to set certain request headers from JS (notably `Referer`). Solutions in an
extension: (1) capture side — `webRequest.onSendHeaders` with `extraHeaders` to read
Referer/Cookie/Origin; (2) replay side — a `declarativeNetRequest` `modifyHeaders` rule rewrites
Referer on outgoing segment requests (MV3-compatible). Old blocking `webRequest` rewrite is
removed on Chrome MV3 but **retained on Firefox**, so Firefox can rewrite directly.

## Ranked shortlist

**Capture:** 1) cat-catch (GPL → patterns) 2) puemos/hls-downloader (MIT → fork base)
3) 54ac/stream-detector (MPL, archived → header-assembly reference).
**Player:** 1) nas-extension (MIT, MV3, hls.js+dash.js) 2) chrome-hls (Apache, MV2, proven at
200k users) 3) hls.js itself (Apache).

## Recommended build strategy
Scaffold fresh; skeleton from `puemos/hls-downloader` (MIT) or a clean WXT init; **reimplement**
the `onSendHeaders` header-capture pattern from cat-catch (pattern, not code); player page modeled
on nas-extension/chrome-hls embedding hls.js 1.6.16 (Apache-2.0). All-permissive stack:
puemos (MIT) + hls.js (Apache) + nas player pattern (MIT) → choose any license.

## Sources
github.com/xifangczy/cat-catch · github.com/puemos/hls-downloader · github.com/54ac/stream-detector
· github.com/Palethorn/nas-extension · github.com/ghouet/chrome-hls · github.com/video-dev/hls.js
· github.com/wisniewskit/hlsify · github.com/Baldomo/open-in-mpv · github.com/Thann/play-with-mpv
· jonlu.ca/posts/illegal-streams
