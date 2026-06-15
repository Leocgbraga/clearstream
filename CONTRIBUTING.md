# Contributing to ClearStream

Thanks for helping! ClearStream is a free, open-source HLS detector + clean player. Keep changes
aligned with the posture: a **neutral per-user tool** — no monetization, no bundled stream
directory, minimal permissions.

## Setup
- Node 24, pnpm 10.28 (`corepack enable`)
- `pnpm install`

## Develop
- `pnpm dev` (Chrome, hot reload) · `pnpm dev:firefox`
- Load unpacked from `.output/chrome-mv3`, or Firefox `about:debugging` → load `.output/firefox-mv3`.

## Before a PR — `pnpm check` must pass
Runs every gate: `tsc` (strict) · ESLint (security rules) · vitest · build (chrome+firefox) ·
bundle budget · no-remote-code audit · web-ext lint.

Live smokes (need the browsers installed locally; also run in CI):
- `pnpm verify` — Chromium via Playwright: real playback + detect + header rule + failover.
- `pnpm verify:firefox` — Firefox via Selenium + geckodriver: playback in Gecko + popup.
- `pnpm verify:fixtures` — Chromium: the real extension + its built deep-capture hook against local
  fixtures replicating hostile delivery/concealment patterns (a detection matrix · VOD/live/failover
  playback · Referer-gating). Server + committed test media live in `tests/fixtures/`.
- `pnpm verify:resolver` — Chromium: the **power build** resolver + schedule lister against local
  fixtures — harvest → hidden-tab resolve → master-probe → rank, popunder suppression, the popup button,
  the domain-agnostic event parser across two layouts, and the 2-level "Watch a game" resolve.
  Power-build only; see [`POWER.md`](POWER.md).

## Debugging on a real site
`pnpm build:debug` (or `pnpm dev`) produces a development build with diagnostics compiled in
(MODE=development; production builds strip all of it via `src/core/debug.ts`). Load
`.output/chrome-mv3-dev` unpacked (or run `pnpm dev`), then on any page:
- the **popup** shows a 🔧 panel: every detected stream, which capture layer found it
  (`scan` / `passive` / `deep`), its kind, and whether all-sites (passive + deep-capture) is granted.
- the **player** logs the hls.js failure *class* to the console for a failed source — e.g.
  "HTTP 403 — gated (Referer/Origin/cookie)", "manifest load failed — CORS/host not granted",
  "media/decode error — DRM cannot play" — so you can tell *why* a real stream didn't play.
Each failure class maps to a fixture in `tests/fixtures/`, so an in-the-wild failure becomes a
reproducible regression test.

## Where things live
- **Pure, unit-tested logic** → `src/core/` (detection/dedupe/ranking, the failover state machine,
  the live-ify heuristic, header merge, url-safety, prefs). No chrome/DOM imports → fast node tests.
  Add a test for any change here (`tests/unit/*.test.ts`).
- **Platform-bound** → `src/entrypoints/` (background, popup, player, deep-capture content scripts).

## Conventions (enforced)
- Render attacker-influenced strings (stream URLs/hosts) via `textContent`/`title` only — never
  `innerHTML`. ESLint `no-unsanitized` + the no-remote-code audit enforce this.
- No remote code: bundle dependencies; never fetch-and-eval.
- Keep `host_permissions: []` at install (no scary warning). Request host access in the "Watch"
  gesture or via the all-sites toggle. Don't add content scripts with static `matches` (that
  re-adds the warning) — register them at runtime (see `deep-*.content.ts` + `syncDeepCapture`).
- New user-facing strings → add to `public/_locales/en/messages.json` and use `t()` (`src/core/i18n`).
- Multi-mirror **resolver** code is off-store: gate it behind `POWER` (`src/core/power.ts`) so it
  folds out of store builds. `pnpm check:store` fails if resolver code / power-only UI / the `tabs`
  permission leaks into the store output. Never cross the §1201 line (render + observe only). See
  [`POWER.md`](POWER.md) + `docs/decisions.md` (D21).

## Hard limits (won't fix)
DRM playback (sandboxed CDM) · CDNs validating Origin/Sec-Fetch (unforgeable in-browser) · DASH
(`.mpd`, no hls.js support). See `docs/decisions.md` (D11).
