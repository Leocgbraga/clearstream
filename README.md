# ClearStream

A free, open-source, cross-browser extension that detects the video stream on the page you're
on and plays it in a **clean, ad-free player** — no popups, no fake buttons, no malvertising.

> **Status:** core engine complete and cross-browser verified (Chrome via Playwright, Firefox via
> Selenium/Gecko). Pre-release — not yet on stores. Full research and architecture live in
> [`docs/`](docs/).

## What it does
When you're on a page playing video over HLS (`.m3u8`), ClearStream detects the stream and plays
it in a bundled [hls.js](https://github.com/video-dev/hls.js) player on the extension's own page —
stripping the host page's ads and popups. It injects the headers the CDN needs, live-ifies
rolling-window streams, and auto-fails-over across mirror streams when one dies.

It runs entirely in **your** browser. No server, no analytics, no accounts, no telemetry.

## What it can't do (honest limits)
- **DRM streams won't play** (Widevine/FairPlay are sandboxed) — this is for unprotected/free HLS,
  not Netflix/Paramount+.
- CDNs that validate the `Origin` or `Sec-Fetch-*` headers (which a browser won't let an extension
  forge) will reject in-browser playback. A future optional native-player handoff recovers those.

## Install
Not on stores yet. To run it now:
- **Chrome / Edge:** `pnpm install && pnpm build`, then load `.output/chrome-mv3` via
  `chrome://extensions` → Developer mode → "Load unpacked."
- **Firefox:** `pnpm build:firefox`, then `about:debugging` → This Firefox → "Load Temporary
  Add-on" → pick any file in `.output/firefox-mv3`.

## Develop
```bash
pnpm install
pnpm dev            # Chrome, hot-reload   (pnpm dev:firefox for Firefox)
pnpm check          # all gates: tsc · eslint · vitest · build · size · no-remote-code · web-ext lint
pnpm verify         # live Chromium smoke (Playwright): real playback + detect + headers + failover
pnpm verify:firefox # live Firefox smoke (Selenium/geckodriver): playback in Gecko + popup
```
Releases are tag-driven — see [`RELEASING.md`](RELEASING.md). Store listing copy is in
[`store/`](store/).

## Tech
WXT · TypeScript · hls.js · media-chrome · Manifest V3 (Chrome, Edge, Firefox). See
[`docs/architecture.md`](docs/architecture.md).

## Docs
- [`docs/`](docs/) — the full knowledge base (architecture, decisions, 10 research reports).
- [`docs/architecture.md`](docs/architecture.md) — start here.
- [`docs/decisions.md`](docs/decisions.md) — why every choice was made.

## License
[MIT](LICENSE). For personal, real-time viewing. Users are solely responsible for ensuring they
have authorization to access any stream the extension detects.
