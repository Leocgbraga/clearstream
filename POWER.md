# ClearStream — Power build (off-store)

The **power build** is an optional, off-store variant of ClearStream for power users who want
one-click resolution of a whole aggregator page, not just reactive detection of the page they're on.
It is distributed via **GitHub / load-unpacked / a signed `.xpi`** — never through the Chrome Web
Store, Edge Add-ons, or AMO. The store listing stays the plain reactive detector + clean player.

> **One hard invariant — no circumvention.** The resolver only **renders** embeds and **observes**
> the `.m3u8` the page itself loads. It **never** decrypts or forges tokens, and never touches DRM.
> That is the DMCA §1201 bright line, and it is a project invariant — see the comment at the top of
> [`src/core/resolver/resolve-tab.ts`](src/core/resolver/resolve-tab.ts) and the review checklist below.
> Point it only at pages you have the right to view.

## Two builds, one codebase

| | **Store build** (`pnpm build`) | **Power build** (`pnpm build:power`) |
|---|---|---|
| Distribution | Chrome / Edge / Firefox stores | GitHub · load-unpacked · signed `.xpi` |
| What it does | Detects the HLS on the current page; clean ad-free player with failover | …**plus** "✨ Resolve streams": follows the page's mirror/embed links to find the stream |
| `host_permissions` | `[]` (granted on demand, per the auto-detect toggle) | `<all_urls>` at install (so resolution + deep-capture work without prompting) |
| Extra `permissions` | — | `tabs` |
| Output dir | `.output/chrome-mv3` (+ `firefox-mv3`, etc.) | `.output/power/chrome-mv3` |

Everything resolver-specific is gated behind a single build-channel flag, so the two builds come from
the same source with **zero** resolver code in the store output (enforced — see *The gate* below).

## What the power build adds: the multi-mirror resolver

On a typical sports aggregator, *playing* the stream is easy; *reaching* it is the hard part — the
links page → mirror list → embed → nested iframe → JS-assembled `.m3u8` maze, behind a
malvertising/popunder gauntlet. The resolver automates that traversal:

1. **Harvest** ([`harvest.ts`](src/core/resolver/harvest.ts)) — scans the current page's links +
   iframes, ranks the ones that look like event mirrors (embed-path / "Link 2 · HD · Server 3" text /
   cross-host iframes), drops social/nav noise, dedupes, caps at 8.
2. **Render in hidden tabs** ([`resolve-tab.ts`](src/core/resolver/resolve-tab.ts)) — opens each
   candidate in a background tab (≤3 concurrent), where the existing deep-capture observes the
   `.m3u8` the page loads, then **always** closes the tab.
3. **Suppress malvertising** — per resolver-tab, a MAIN-world neutralizer noops `window.open`, blocks
   `target=_blank` clicks, and strips `<meta refresh>`. **Scoped strictly to the resolver's own
   tabs** — never your normal browsing.
4. **Prefer the best** ([`master-probe.ts`](src/core/resolver/master-probe.ts)) — if only a variant
   resolves, probe sibling `master.m3u8`/`index.m3u8` and prefer the master (full quality ladder),
   then dedupe + rank across all mirrors.
5. **Play** — the ranked list goes to the **existing** failover player + header injection. No player
   changes; resolution just feeds it a richer, pre-resolved list.

Bounds are explicit and logged: max 8 mirrors, 3 concurrent tabs, per-tab timeout (~18 s) + a capture
debounce. A Cloudflare interstitial in a resolver tab is **skipped**, never auto-solved.

## Plus: jump straight to a game (schedule lister)

On an aggregator's schedule/landing page (the "Today's Games (24)" list), the popup surfaces the games
directly so you skip clicking through the schedule's ad-trap links:
- **📅 Live & upcoming** list in the popup (live-first; finished greyed), parsed from the page.
- **Open** — jump straight to a game's event page via its clean URL (bypasses the schedule's
  booby-trapped onclick/popunders); then **Resolve streams** there.
- **▶ Watch** — one click: resolve that game end-to-end (open its event page in hidden tabs, harvest its
  mirrors, resolve, play the best) — every ad page skipped. A 2-level use of the resolver.

**Domain-agnostic — no per-site selectors.** The scan ([`background.ts` `scanForEvents`] across all
frames) harvests both `<a href>` **and clickable non-anchors** — `onclick` / `data-href` `<div>`s, the
way real sites (e.g. streameast) render game tiles to fire popunders + dodge scrapers, recovering the
target URL from the onclick handler. The pure parser ([`events.ts`](src/core/resolver/events.ts)) then
scores each candidate from orthogonal signals (a "Team A vs Team B" matchup in the tile text, the URL
slug, or the enclosing card/row; a sport/league keyword; a live/time cue) and reads the title from
whichever source has it (text → slug → row → JSON-LD), with status/sport read from each game's own
card/row. Verified against the real streameast homepage structure (23 onclick-`<div>` cards →
`/links/<slug>`). The 🔧 debug panel shows a per-frame readout (a[href] / clickable / "vs" counts +
samples) so any live page reveals exactly what it has.

Known limits: (1) games rendered by site JS that never populates the readable DOM (e.g. crackstreams'
`/league/*` pages use obfuscated JS) won't appear — the 🔧 readout confirms this per site. (2) Sites
whose **homepage is only sport categories** (crackstreams) list nothing on the homepage; the games are
on the `/league/<sport>` pages. A full-domain crawl (render each category page, aggregate) is the planned
fix for that case — deferred pending confirmation it's needed (see memory).

## Build & install

### Chrome / Edge / Chromium
```bash
pnpm build:power           # → .output/power/chrome-mv3
```
`chrome://extensions` → enable **Developer mode** → **Load unpacked** → select
`.output/power/chrome-mv3`. The build declares `<all_urls>` at install, so resolution works
immediately (no per-site prompt).

### Firefox
```bash
pnpm build:power           # the same gate applies to `wxt build -b firefox` under CS_POWER=1
```
Load `.output/power/firefox-mv3` via `about:debugging` → **This Firefox** → **Load Temporary
Add-on**, or install a signed `.xpi` (self-distributed AMO signing; not a store listing).

> The MAIN-world neutralizer is Chromium-only (Firefox has no MAIN-world content scripts), so on
> Firefox the resolver renders + captures but relies on the page's own popup behavior.

## The gate (how store builds stay clean)

- [`src/core/power.ts`](src/core/power.ts) exports `POWER`, compiled from the `__POWER__` Vite define
  (`CS_POWER=1` → `true`, unset → `false`). Every resolver entry point is behind `if (POWER) { … }`
  or a `POWER ? … : []` branch.
- With `CS_POWER` unset, `POWER` folds to `false` → esbuild eliminates every resolver branch and
  tree-shakes the side-effect-free resolver modules out entirely.
- [`scripts/check-store-clean.mjs`](scripts/check-store-clean.mjs) (run by `pnpm check`) **fails the
  build** if the store output contains the resolver sentinel (`CS_POWER_RESOLVER`), a power-only UI
  string, the `tabs` permission, or any `host_permissions`. That's the guarantee the gate holds.

## Why off-store (and why that's fine)

The stores' policy hook — *an extension must not "enable unauthorized access to content"* — doesn't
distinguish "the user clicked a button" from "the extension did it." Active multi-mirror resolution
trips that review regardless of intent, so it **can't ride a store listing**. Off-store, it's the
same well-trodden pattern as `yt-dlp`, Kodi's ResolveURL, and FetchV: a neutral power-user tool you
install yourself and point at pages you're entitled to view. ClearStream keeps the reactive
detector+player on the stores (broad reach, clean posture) and the resolver off-store (power, opt-in).

See [`docs/decisions.md`](docs/decisions.md) **D21** for the full rationale and what was rejected.

## Review checklist (every resolver change)
- [ ] Only **renders** embeds + **observes** the page's own `.m3u8` — no token decrypt/forge, no DRM.
- [ ] All new resolver code is behind `POWER` (and `pnpm check:store` stays green).
- [ ] Bounds + caps are enforced **and logged** (no silent truncation).
- [ ] Ad/popup suppression stays scoped to resolver-opened tabs only.
- [ ] Cloudflare/interstitial in a resolver tab → skip, never auto-solve.

## Verify
```bash
pnpm verify:resolver       # builds the power target, then drives the harness in real Chromium
```
Asserts, against local fixtures only (no external/pirate sites): a single embed resolves to its
`.m3u8` and the tab is cleaned up; a links page is harvested → each mirror resolved → master mirror
ranked first; the popunder mirror's `window.open` is suppressed (no orphan tab); and the power popup's
Resolve button is present + wired. The store build is proven resolver-free by `pnpm check:store`.
