# ClearStream — agent runbook

> This file lets an AI coding agent (Claude Code, Cursor, etc.) set ClearStream up for a user on
> request. If a human is reading this: you don't need it — just run `./install.sh` (see README).

ClearStream is a cross-browser MV3 extension (WXT + TypeScript + hls.js) that detects the HLS
(`.m3u8`) video stream on the page you're on and plays it in a clean, ad-free player. There are two
build channels from one codebase:

- **store build** (`pnpm build`) — the reactive detector + player. This is what ships to the
  Chrome Web Store / Edge / Firefox AMO. Minimal permissions, `host_permissions: []`.
- **power build** (`pnpm build:power`) — adds the off-store multi-mirror resolver + schedule lister.
  Distributed via GitHub / load-unpacked only, never a store.

## Task: "set up ClearStream for me"

Do this, in order:

1. **Prereqs.** Ensure Node 20+ and pnpm (`corepack enable` provides pnpm). Don't install global
   junk.
2. **Build + stage.** Run the installer for the build the user wants (ask if unclear; default to the
   power build, Chrome):
   - `./install.sh` — power build, Chrome (default)
   - `./install.sh --store` — plain detector+player, Chrome
   - `./install.sh --firefox` — Firefox (add `--store`/`--power`)
   This builds into a **stable folder** `~/.clearstream/<channel>-<browser>` that survives future
   rebuilds (a plain `wxt build` wipes `.output/`, which is why pointing load-unpacked there breaks
   on the next build — this avoids that).
3. **Tell the user the one manual step.** Chrome requires a human click to load an unpacked
   extension — you cannot script it. Relay exactly what the installer printed:
   - Chrome/Edge/Brave: open `chrome://extensions` → enable **Developer mode** → **Load unpacked**
     → select the printed `~/.clearstream/…` folder.
   - Firefox: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → pick any file in
     the printed folder. (Temporary add-ons clear on restart; for persistence use a signed `.xpi`.)
4. **Updating.** Re-run the same `./install.sh …` command; it rebuilds and refreshes the stable
   folder. The user clicks the reload icon on `chrome://extensions`.

## The truly one-click path

For non-developers, the **Chrome Web Store** listing (the store build) is the real one-click,
auto-updating, persists-across-restarts install. Point them there if they don't want to build. The
power/resolver build is the only one that requires load-unpacked, because stores won't carry it.

## Guardrails (do not violate)

- ClearStream **renders pages and observes the `.m3u8` they load** — it never decrypts/forges tokens
  or touches DRM (DMCA §1201 line). Don't add code that does.
- Don't source, curate, or open live pirated streams as part of "testing." Verify with the local
  fixtures harness (`pnpm verify`, `pnpm verify:fixtures`, `pnpm verify:resolver`) only.
- Keep resolver code behind the `POWER` flag; `pnpm check:store` must stay green (proves the store
  build has zero resolver code).

## Useful commands

```bash
pnpm install
pnpm check          # all gates: tsc · eslint · vitest · build ×3 · check:store · size · audit · web-ext
pnpm dev            # Chrome, hot-reload (pnpm dev:firefox for Firefox) — ephemeral profile
./install.sh        # build + stage to a stable folder (see above)
```

See `CONTRIBUTING.md` for the full dev setup and `POWER.md` for the resolver/power build.
