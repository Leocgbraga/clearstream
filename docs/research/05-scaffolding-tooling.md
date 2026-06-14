# Research 05 — Scaffolding, tooling & scratch-vs-fork

> Verbatim research report (opinionated).

## TL;DR
1. **Framework: WXT.** Only actively-maintained, Vite-based, framework-agnostic option that builds
   Chrome+Firefox+Edge (+Safari later) from one codebase and auto-resolves the MV3-service-worker
   vs Firefox-`background.scripts` manifest split. Plasmo = maintenance limbo (Parcel); CRXJS =
   Chromium-only + can't make ZIPs; plain Vite/vanilla = hand-roll cross-browser manifests.
2. **Layout:** WXT `entrypoints/` with `srcDir:"src"`. Background = `background.ts`; content =
   `content.ts`; popup = `popup/`; the clean player = an **unlisted** `player/index.html` page
   served from the extension origin (the keystone — extension page + host_permissions bypasses CORS).
3. **Scratch, not fork.** Scaffold fresh with WXT; **port detection from our own
   `stream/extractor.py`** (already does first-manifest-wins `.m3u8`/`.mpd` capture + header/cookie
   grab). cat-catch = GPL-3.0 (incompatible) + jQuery monolith; nas-extension = MIT but Angular,
   near-dead, redirects to external player; **puemos/hls-downloader (MIT)** = best to *mine* for
   DNR/webRequest/popup patterns but Redux+redux-observable+styled-components is too heavy to inherit.
4. **Deps for v1:** `wxt` + `hls.js` + **no UI framework** (vanilla TS). Add `@webext-core/messaging`
   only if message-passing gets unwieldy.

## Framework comparison (scored for lightweight + cross-browser + low ceremony)
| Criterion | **WXT** | Plasmo | CRXJS+Vite | Plain Vite | Vanilla |
|---|---|---|---|---|---|
| Chrome+FF+Edge one codebase | ✓ first-class | ✓ (FF lags) | **✗ Chromium only** | DIY | DIY |
| SW vs FF background.scripts | **auto** | auto | manual-ish | manual | manual |
| Bundler | Vite/Rollup | **Parcel** | Vite | Vite | none |
| HMR/DX | HMR + opens browser w/ ext | HMR (React) | reloads whole ext | Vite HMR | none |
| Per-browser manifest | config/auto MV2↔MV3 | config | manual | manual | manual |
| Health (2026) | **active v0.20.26, ~10k★** | maintenance mode | uncertain | n/a | n/a |
| Store niceties | **FF source ZIP + publish** | publish | can't ZIP | DIY | DIY |

**Why WXT wins here:** eliminates the cross-browser background-key footgun (`defineBackground`
→ right shape per target); its default MV2-for-Firefox can be forced to MV3 with `--mv3` (you want
MV3 + FF's retained blocking webRequest, from one source); Vite not Parcel; CRXJS disqualified by
no-cross-browser; vanilla makes you the manifest compiler. Counter (vanilla like cat-catch) rejected:
cat-catch is a high-discipline manual monolith — WXT gives the lightweight *output* without the *ceremony*.

## Recommended layout (WXT, vanilla-TS, `srcDir:"src"`)
```
stream-extension/
├─ wxt.config.ts          # ONE place for manifest + per-browser config
├─ package.json  tsconfig.json
├─ src/
│  ├─ entrypoints/
│  │  ├─ background.ts     # auto → service_worker (Chrome) | background.scripts (FF)
│  │  ├─ content.ts        # defineContentScript — optional DOM sniffing
│  │  ├─ popup/{index.html, main.ts}
│  │  └─ player/{index.html, main.ts}   # ★ unlisted page, getURL('/player.html'), CORS-free
│  ├─ utils/               # auto-imported: detection.ts (port extractor.py), headers.ts
│  ├─ assets/  public/{icons, _locales}
├─ .output/{chrome-mv3, firefox-mv2}   # gitignored
```
Keep it minimal — no `components/`/`composables/` dirs for vanilla TS.

## Scratch vs fork — definitive
- **puemos/hls-downloader (MIT, 2.6k★, active, TS):** best *reference* (DNR rules, webRequest
  sniffing, dual MV2/MV3 build), wrong *base* (Redux+styled-components+download pipeline; you'd
  delete more than you keep).
- **cat-catch (GPL-3.0, 20k★):** **don't fork — license-incompatible** (would force GPL). Read for
  ideas (mature m3u8/mpd UX) at arm's length.
- **nas-extension (MIT, 32★, Angular, stale 2024):** reject (abandoned, Angular, uses *external*
  hls.js rather than bundling).
- **Why scratch wins:** you already own the hardest part — `extractor.py` is the proven detection
  core to port. A fresh `wxt init` vanilla-TS project is ~10 files; de-Redux-ing/de-GPL-ing a fork
  costs more than scaffolding.

## Minimal deps (v1)
```jsonc
{ "type":"module",
  "dependencies": { "hls.js": "^1.6.16" },           // Apache-2.0 (use hls.light.mjs OR full — see research 07)
  "devDependencies": { "wxt": "^0.20.26", "typescript": "^5.x" } }
```
Scripts: `wxt`, `wxt -b firefox`, `wxt build`, `wxt zip`, `wxt zip -b firefox` (FF zip + source
ZIP). Lean argument: every dep is shipped bytes + supply-chain liability for a tool users install
with broad host perms — only hls.js clears that bar. (Note: research 07 argues **full** hls.js
build over light for alt-audio; this report suggested light for size — full wins on function.)

## Next steps (post-plan)
```sh
pnpm dlx wxt@latest init stream-extension   # vanilla (TypeScript)
cd stream-extension && pnpm add hls.js
# set srcDir:"src"; add host_permissions + webRequest/declarativeNetRequest
# port detection from ../Stream/stream/extractor.py → src/utils/detection.ts
pnpm dev ; pnpm dev:firefox
```
The existing `~/dev/personal/Stream` Python tool is the predecessor — **do not fork/modify**; use
`extractor.py` purely as the detection reference.

## Sources
wxt.dev (+ /guide/resources/compare, installation, project-structure, entrypoints, target-different-
browsers, config/manifest) · github.com/wxt-dev/wxt · redreamality.com 2025 framework analysis ·
trybuildpilot.com WXT-vs-Plasmo-vs-CRXJS-2026 · jetwriter.ai plasmo→wxt migration ·
github.com/{puemos/hls-downloader, xifangczy/cat-catch, Palethorn/nas-extension, video-dev/hls.js}
· npmjs hls.js · hls.js issue #4936 (bundle size).
