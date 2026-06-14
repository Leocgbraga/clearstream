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

## Hard limits (won't fix)
DRM playback (sandboxed CDM) · CDNs validating Origin/Sec-Fetch (unforgeable in-browser) · DASH
(`.mpd`, no hls.js support). See `docs/decisions.md` (D11).
