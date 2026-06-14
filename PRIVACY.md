# Privacy Policy — ClearStream

**ClearStream collects nothing. It has no analytics, no tracking, no accounts, and no servers —
it never phones home.**

## What stays on your device
- **Detected streams** are held in temporary session storage and are cleared when you close your
  browser.
- **Preferences** (volume) and **which video hosts have worked before** (so playback is
  faster next time) are stored locally on your device only. They are never synced or uploaded.

## Permissions, and why
- **activeTab / scripting** — when you click the toolbar button, ClearStream scans *only the
  current tab* for a stream. Nothing runs on any page until you click.
- **declarativeNetRequest** — sets the Referer/Cookie/User-Agent headers a CDN requires, scoped to
  the player tab, so your chosen stream plays. (On Firefox this is done with blocking webRequest.)
- **webRequest** — optional; only if you turn on "auto-detect on all sites," to notice streams as a
  page loads. Inert until you grant host access.
- **Optional host access** — requested only when you click "Watch," and only for the specific
  video host of the stream you chose. You can revoke it at any time.
- **storage** — to remember your settings and which hosts have worked before, locally.

## No data collection
ClearStream does not collect, transmit, sell, or share any personal data. The only network
requests it makes are to fetch the video stream you choose to watch, directly from its source.

## Responsibility
ClearStream is a neutral media player. Users are solely responsible for ensuring they have
authorization to access any stream the extension detects.
