# Microsoft Edge Add-ons — submission notes

Use the copy in [`../listing.md`](../listing.md). The Edge build is the Chromium build, so the
package and review posture mirror Chrome.

- **Package:** `clearstream-<v>-edge.zip` (functionally identical to the Chrome build)
- **Category:** Developer tools
- **Language:** English

## Notes
- Edge uses the same MV3 package as Chrome (no Edge-specific manifest changes). Detection, the DNR
  header injector, and the player are all verified on Chromium.
- **Data collection:** declare none. Privacy policy URL required (host `PRIVACY.md`).
- **Certification notes (paste):** Neutral HLS (`.m3u8`) detector & player. Bundled hls.js +
  media-chrome, no remote code, MV3 default CSP. No YouTube, no DRM. Empty `host_permissions` at
  install; per-host access requested at "Watch."
- First upload is manual (creates the product ID → `EDGE_PRODUCT_ID`); after that `release.yml`
  updates the listing via the Partner Center API.
- Edge auto-distributes to other Chromium browsers' users who visit the Edge store; the same zip
  also "loads unpacked" in Brave/Opera/Vivaldi for power users.
