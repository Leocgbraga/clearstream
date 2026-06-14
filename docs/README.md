# ClearStream — Documentation & Research Knowledge Base

This `docs/` tree is the **permanent record** of the research and decisions behind ClearStream,
a free, open-source, cross-browser extension that detects HLS streams on the current page and
plays them in a clean, ad-free hls.js player.

> Captured from a multi-agent research effort (June 2026). Nothing here is lost when the
> originating chat ends — this is the source of truth.

## How to read this

| File | What it is |
|---|---|
| [`architecture.md`](architecture.md) | The synthesized architecture & production plan — **start here**. |
| [`decisions.md`](decisions.md) | ADR-style log of every locked decision + the rejected alternatives. |
| [`research/`](research/) | The full, verbatim research reports (10 deep passes) with source URLs. |

## The research passes

| # | File | Focus |
|---|---|---|
| 01 | [reusable-oss](research/01-reusable-oss.md) | Existing OSS extensions to fork or mine for patterns + licenses |
| 02 | [mv3-recipe](research/02-mv3-recipe.md) | MV3 capture + DNR header-rewrite + hls.js playback recipe & hard limits |
| 03 | [distribution-policy](research/03-distribution-policy.md) | Store policies, the survivable framing, distribution channels |
| 04 | [cors-feasibility](research/04-cors-feasibility.md) | Why a pure web app fails / the extension wins (CORS deep-dive) |
| 05 | [scaffolding-tooling](research/05-scaffolding-tooling.md) | WXT vs Plasmo/CRXJS; scratch-vs-fork; minimal deps |
| 06 | [capture-engine](research/06-capture-engine.md) | L1/L2/L3 detection, header capture, service-worker survival |
| 07 | [player-engine](research/07-player-engine.md) | hls.js config, pLoader ENDLIST live-ify, header injection, failover |
| 08 | [cross-browser](research/08-cross-browser.md) | Chrome DNR vs Firefox webRequest, Safari, per-browser manifests |
| 09 | [ux-permissions](research/09-ux-permissions.md) | Minimal-permission model, detect→watch flow, failover UX |
| 10 | [security-testing-release](research/10-security-testing-release.md) | CSP/no-remote-code, testing, CI/CD tri-store publish |
| 11 | [scaffold-donors](research/11-scaffold-donors.md) | Boilerplate/skeleton repos + building blocks to pull in (media-chrome, auto-icons, …) |

## One-paragraph summary

A browser extension is the right form factor because it runs in the user's own browser: no
Python/mpv install, already past Cloudflare, carries CDN cookies, and **bypasses CORS** (a plain
web app can't — only ~20–30% of these streams are CORS-open). It detects the `.m3u8` via
`declarativeNetRequest` (silent, zero install warning), plays it in a bundled hls.js player page
(CORS bypassed via host permission requested at "Watch"), injects `Referer`/`Cookie` via DNR
(Chrome) / blocking webRequest (Firefox), live-ifies stale-`ENDLIST` playlists via a custom
hls.js `pLoader`, and auto-fails-over across mirror streams. Built with WXT (Chrome/Edge/Firefox
from one codebase), shipped free to AMO + Chrome + Edge + GitHub. **Hard limits:** DRM is
impossible; CDNs that validate `Origin`/`Sec-Fetch-*` reject in-browser playback (a future
native-mpv handoff recovers those).
