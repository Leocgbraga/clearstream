# Chrome Web Store — submission notes

Use the copy in [`../listing.md`](../listing.md). Chrome-specific fields below.

- **Package:** `clearstream-<v>-chrome.zip`
- **Category:** Developer Tools
- **Language:** English

## Privacy practices tab (must match reality)
- **Single purpose:** paste the single-purpose statement from `listing.md`.
- **Permission justifications:** paste each one from `listing.md` → "Permission justifications".
- **Host permission justification:** the optional `*://*/*` is requested per-host, only inside the
  user's "Watch" click, solely to let the player fetch the chosen stream directly. Not used to read
  browsing.
- **Data usage:** check **"This item does not collect user data."** Then certify you do **not**
  sell/transfer data and don't use it for unrelated purposes / creditworthiness. (All true.)
- **Privacy policy URL:** required — host `PRIVACY.md` (GitHub raw or Pages) and link it.

## Review-friction notes
- Framed as a **detector & player** (Developer Tools), with explicit "no YouTube, no DRM" in the
  description — this is what keeps it in policy as a neutral tool rather than a piracy destination.
- Empty `host_permissions` at install → no "read your data on all sites" install warning; access is
  granted per-host at "Watch."
- No remote code: hls.js + media-chrome are bundled; MV3 default CSP (no custom CSP). If a reviewer
  asks, point to `scripts/audit-no-remote-code.mjs` (0 eval / remote scripts).
- First upload is manual (creates the item ID → `CHROME_EXTENSION_ID`); after that `release.yml`
  updates the listing.
