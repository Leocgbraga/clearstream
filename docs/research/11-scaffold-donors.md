# Research 11 — Scaffold / boilerplate / building-block donors

> Verbatim research report. Question: are there scaffold/skeleton/boilerplate GitHub repos to
> adopt so we don't write boilerplate from scratch? **Bottom line: keep the WXT scaffold; adopt
> nothing wholesale; pull in a few specific MIT/Apache building blocks.**

## 1. Official WXT templates & examples
`wxt init` scaffolds five **bare** TS templates (vanilla/react/vue/svelte/solid) — no tests, no CI,
no i18n. We're already past this. The useful part is **`github.com/wxt-dev/wxt-examples`** (MIT) —
copy-paste references: **Messaging (one-time-requests / long-lived)**, **Vitest**, **Playwright**,
**I18n**, **TailwindCSS**, IndexedDB, Welcome Page, Devtools. No popup-only/options/video example →
the player UI must come from elsewhere.
**Action:** copy the messaging + vitest examples when we build Phase 1 / Phase 6.

## 2. Batteries-included MV3 boilerplates — borrow structure, don't adopt
| Boilerplate | Stack | License/★ | Status | Verdict |
|---|---|---|---|---|
| Jonghakseo/chrome-extension-boilerplate-react-vite | React+Vite+Turborepo | MIT / 4.9k | **ARCHIVED Feb 2026** | Skip (read-only, React-heavy); glance at its `.github/workflows` publish step |
| JohnBra/vite-web-extension | React 19+Vite | MIT / 1.2k | quiet | Skip (React, no tests) |
| antfu/vitesse-webext | Vue 3+UnoCSS | MIT / 3.4k | active | Skip (wrong framework); confirms `webext-bridge` |
| PlasmoHQ/plasmo | own framework | MIT | active | Competitor, not a donor — switching = leaving WXT |
| extension.js | framework-agnostic | MIT | active | Competitor, not a donor |
**Conclusion:** don't switch. We're on the leading framework. Only worth lifting: a small
store-publish GitHub Action around `wxt zip`.

## 3. HLS / video-player donors (the player UI)
| Repo | MV3 | Stack | Player UI? | License | Status | Donor value |
|---|---|---|---|---|---|---|
| **puemos/hls-downloader** | ✅ | React+Redux | ❌ download-only | **MIT** | very active (v5.4.4) | **Best donor** — lift background `webRequest` m3u8 detection + `core/` HLS parsing + popup-list pattern |
| **video-dev/hls.js `/demo`** | n/a | vanilla | ✅ 3 quality modes | **Apache-2.0** | active | Reference for `hls.levels` ↔ quality wiring (we already bundle hls.js) |
| Palethorn/nas-extension | ✅ | Angular | ✅ hls.js+dash.js | MIT / 32 | slow | Angular → hard to lift; reference for DNR-redirect only |
| ghouet/chrome-hls | older | vanilla+jQuery | ✅ player page | Apache / 85 | dated | jQuery dep → low priority |
| Chromo-lib/m3u8 | ✅ | vanilla+Vite | ✅ player page | MIT / 23 | tiny | Closest stack match; quick read only |
**Recommendation:** detection+parsing from puemos (MIT); hls.js `/demo` as wiring reference; but
build controls from **media-chrome** (below), not by porting Angular/jQuery pages.

## 4. Reusable building blocks (where we cut the most boilerplate)
| Library | Gives us | License | Pull? |
|---|---|---|---|
| **media-chrome** (Mux) | **The player controls** — play/seek/volume/fullscreen + **`<media-rendition-menu>` quality selector** wired to `hls.levels`. Framework-agnostic web components, bundle locally. | **MIT**, very active (v4.19.2) | **YES — top pick** (player UI) |
| **@wxt-dev/auto-icons** | All icon sizes from one source image at build | MIT (official) | **YES — cheap win** (replaces our gen-icons hack) |
| **@wxt-dev/i18n** | Type-safe `browser.i18n` | MIT (official) | YES when localizing |
| **wxt/storage** | Typed storage w/ `defineItem`, watchers | MIT | **Already built into WXT** — use it |
| **@webext-core/messaging** | Type-safe bg↔popup messaging (by WXT author) | MIT | Optional — adopt if messaging grows; else copy wxt-examples pattern |
| **@webext-core/proxy-service** | Type-safe RPC popup→background | MIT | Optional |
| webext-bridge | cross-context messaging | MIT | Skip (prefer @webext-core/messaging) |
| vidstack | full skinned player | MIT | Alternative to media-chrome (heavier); media-chrome is leaner |
| @webext-core/job-scheduler | cron jobs | MIT | Skip (no need) |

## VERDICT
Keep the WXT scaffold; adopt nothing wholesale. Pull in (all MIT/Apache):
1. **media-chrome** → player controls + quality selector (biggest boilerplate killer). [DONE: dep added, player shell wired]
2. **@wxt-dev/auto-icons** → icons from one source. [DONE: replaced gen-icons placeholder]
3. **puemos/hls-downloader** (MIT) → copy detection + HLS parsing (Phase 1).
4. **hls.js `/demo`** (Apache) → quality-wiring reference (Phase 2).
5. **@wxt-dev/i18n** + **wxt/storage** → official, cheap; storage already built in.
6. **wxt-examples** messaging + Vitest → copy when building Phase 1 / Phase 6; upgrade to
   `@webext-core/messaging` if messaging grows. Don't use webext-bridge too.
**Do NOT:** migrate to Plasmo/extension.js; port the Angular/jQuery player pages; pull a React monorepo.

## Sources
github.com/wxt-dev/wxt-examples (+ examples.json) · github.com/{Jonghakseo/chrome-extension-
boilerplate-react-vite, JohnBra/vite-web-extension, antfu/vitesse-webext, PlasmoHQ/plasmo} ·
github.com/{puemos/hls-downloader, video-dev/hls.js (/demo), Palethorn/nas-extension, ghouet/chrome-hls,
Chromo-lib/m3u8} · github.com/muxinc/media-chrome (+ media-chrome.org/docs media-rendition-menu) ·
github.com/aklinker1/webext-core · npm @wxt-dev/{auto-icons,i18n,storage} · github.com/vidstack/player.
