# Releasing ClearStream

Releases are tag-driven. Pushing a `v*` tag runs [`.github/workflows/release.yml`](.github/workflows/release.yml),
which builds + zips all three targets, attaches a build-provenance attestation, and creates a
GitHub Release. **Store publishing is opt-in:** each store step runs only if its secrets are set,
so you can cut GitHub Releases today and wire up stores later.

## Cut a release

```bash
pnpm check                       # all gates green locally first
npm version patch                # bumps package.json (0.0.1 → 0.0.2) + commits + tags v0.0.2
git push --follow-tags
```

WXT reads the version from `package.json`, so every manifest is stamped automatically. The tag
must match the `package.json` version (`npm version` guarantees this).

## What you always get (no secrets needed)
- `clearstream-<v>-chrome.zip`, `-firefox.zip`, `-edge.zip`, `-sources.zip` in `.output/`
- A GitHub Release with those zips attached + auto-generated notes
- A provenance attestation (verifiable with `gh attestation verify`)

For Chrome power users, "load unpacked" the unzipped `chrome` build. For Firefox, the AMO-signed
`.xpi` (once AMO is configured) installs directly; unsigned builds load via `about:debugging`.

## Before your first store submission (one-time gates)
- **Privacy policy URL (required by all three stores):** host `PRIVACY.md` at a live `https://`
  URL — GitHub Pages, the repo's `PRIVACY.md` blob/raw link, or any static host — and paste that
  URL into each store dashboard (Chrome, Edge, AMO). The copy in `store/` references `PRIVACY.md`;
  the stores need a resolvable URL, not a repo-relative path. Do this before the first manual upload.
- **Data collection:** declare **none** — the extension sends nothing off-device.

## Wiring up store publishing (optional)
Add these as repository secrets (Settings → Secrets and variables → Actions). The `release`
environment can also gate publishing behind a manual approval (Settings → Environments → release).

### Chrome Web Store
| Secret | How to get it |
|---|---|
| `CHROME_EXTENSION_ID` | The item ID from the Web Store dev dashboard after first manual upload |
| `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN` | Google Cloud OAuth client for the Chrome Web Store API ([guide](https://github.com/fregante/chrome-webstore-upload-keys)) |

### Edge Add-ons
| Secret | How to get it |
|---|---|
| `EDGE_PRODUCT_ID` | Product ID from Partner Center after first manual upload |
| `EDGE_CLIENT_ID`, `EDGE_API_KEY` | Partner Center → Publish API credentials |

### Firefox AMO
| Secret | How to get it |
|---|---|
| `AMO_API_KEY`, `AMO_API_SECRET` | https://addons.mozilla.org/developers/addon/api/key/ |

The first submission to each store must be done **manually** through its dashboard (to create the
listing, accept policies, and get the ID). After that, the workflow updates the existing listing.

## Self-hosting the signed Firefox `.xpi`
For a non-AMO install link, sign an unlisted build:
```bash
AMO_API_KEY=… AMO_API_SECRET=… pnpm exec web-ext sign \
  --source-dir .output/firefox-mv3 --channel=unlisted
```
Host the resulting `.xpi` + an `updates.json` for auto-updates (Chrome blocks sideloaded `.crx`,
so self-hosting is Firefox-only; on Chrome, GitHub "load unpacked" is the power-user path).
