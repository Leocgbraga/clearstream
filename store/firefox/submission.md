# Firefox AMO — submission notes

Use the copy in [`../listing.md`](../listing.md). AMO-specific fields below. AMO is the most
permissive of the three stores and is our primary, most resilient channel.

- **Package:** `clearstream-<v>-firefox.zip`
- **Add-on ID:** `clearstream@daedastream.dev` (set in the manifest)
- **Categories:** "Other" (and optionally "Web Development")
- **Data collection:** the manifest declares `data_collection_permissions: { required: ['none'] }`;
  in the listing, confirm **no data collected**.

## Source code (required)
AMO requires reviewable source for bundled/minified add-ons. `release.yml` uploads
`clearstream-<v>-sources.zip`. Reviewer build instructions:
```
corepack enable && pnpm install --frozen-lockfile && pnpm zip:firefox
# output: .output/clearstream-<v>-firefox.zip
```
Toolchain: Node 24, pnpm 10.28, WXT 0.20. No network access needed during build.

## Reviewer notes (paste into "Notes to reviewer")
- ClearStream is a neutral HLS media player. It detects the `.m3u8` stream on the user's current
  page and plays it in a bundled hls.js player. It is **not** a directory and ships no list of
  sites or streams — it reacts only to the page the user already opened.
- No remote code: hls.js (Apache-2.0) and media-chrome (MIT) are bundled; nothing is fetched and
  executed at runtime.
- `webRequestBlocking` is used only to set Referer/Cookie/User-Agent for the chosen stream's
  requests (Firefox's DNR domain conditions are unreliable, so blocking webRequest is the correct
  backend here). Header rewriting is scoped to the active player tab.

## Min versions
`strict_min_version` 140 (desktop) / 142 (Android) — the floors that honor the
`data_collection_permissions` manifest key.
