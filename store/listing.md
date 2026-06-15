# Store listing — canonical copy

Shared source of truth for all three stores. Per-store quirks (field limits, categories,
permission-justification forms) are in `chrome/`, `firefox/`, `edge/`. Keep this neutral,
honest, and framed as a **detector & player** (a developer/media tool), never as a way to find or
watch specific content.

---

**Name:** ClearStream — HLS Stream Detector & Player

**Summary (≤132 chars):**
Detects HLS (.m3u8) video streams on the page and plays them in a clean, ad-free player. No YouTube, no DRM.

**Category:** Developer Tools

---

## Description

ClearStream detects the HLS (`.m3u8`) video stream playing on the page you're already on and plays
it in a clean, bundled player — no popups, no fake "play" buttons, no malvertising overlays.

Everything runs in your own browser. There is no server, no account, no analytics, and no
telemetry. ClearStream never sees or stores where you browse.

**Features**
- One-click detection of the HLS stream on the active tab
- A clean, bundled hls.js player with quality selection, fullscreen, and keyboard shortcuts
- Automatic failover across mirror streams when one stops
- Sends only the headers a CDN needs (Referer / Cookie / User-Agent) so locked streams keep playing
- Works the same on Chrome, Edge, and Firefox

**What it deliberately doesn't do**
- It does **not** play DRM-protected video (Netflix, Disney+, Paramount+, etc.) — those use a
  sandboxed decryption module an extension cannot touch.
- It does **not** work on YouTube or other sites with their own players/terms.
- It is **not** a directory of streams. It only reacts to the page you open yourself.
- Some CDNs validate headers a browser won't let any extension forge (`Origin`, `Sec-Fetch-*`);
  those streams won't play in-browser.

**Open source:** the full code, architecture, and design decisions are public.

**Your responsibility:** ClearStream is a neutral media player. You are solely responsible for
ensuring you have the right to access any stream it detects.

---

## Single-purpose statement (Chrome requires this)
ClearStream has one purpose: to detect the HLS video stream on the user's current page and play it
in a clean, ad-free player.

## Permission justifications
- **activeTab + scripting** — When you click the toolbar button, ClearStream scans *only the
  current tab* for an HLS stream. Nothing runs on any page until you click.
- **storage** — Saves your preferences (volume) and which video hosts have worked before,
  locally on your device. Never synced or uploaded.
- **declarativeNetRequest** — Sets the Referer/Cookie/User-Agent headers a CDN requires, scoped to
  the player tab only, so the stream you chose will play.
- **webRequest** — Optional. Only if you enable "auto-detect on all sites," to notice streams as a
  page loads. Inert until you grant it.
- **Optional host access (`*://*/*`)** — Requested only when you click "Watch," and only for the
  specific video host of the stream you chose. Revocable any time. This is what lets the player
  fetch the stream directly (bypassing CORS) instead of through any server of ours.

## Links
- Privacy policy: https://leocgbraga.github.io/clearstream/privacy.html
- Source code & docs: https://github.com/leocgbraga/clearstream (MIT)
