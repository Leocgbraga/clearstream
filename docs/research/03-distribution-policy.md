# Research 03 — Distribution & store-policy reality

> Verbatim research report. Where a free HLS detector+player can actually live, post the 2025
> Chrome Web Store purge, and the framing that survives.

## The policy hinge: "unauthorized"
Chrome Web Store "Malicious and Prohibited Products" policy:
> "Do not encourage, facilitate, or enable the **unauthorized** access, download, or streaming of
> copyrighted content or media." / "...circumventing paywalls or login restrictions."

The operative word is **"unauthorized."** It's not a ban on streaming/downloading per se — it's a
ban on doing so without authorization. Every surviving extension exploits this distinction.

## What caused the 2025 "purge" (two engines, not one)
1. **MV2 → MV3 forced migration** — Chrome disabled remaining MV2 extensions (Chrome 139, ~July
   2025); abandoned downloaders simply stopped working. CWS shrank ~137k → ~112k.
2. **Renewed enforcement** on extensions explicitly marketed as "rip any site," "bypass DRM,"
   "download YouTube" (SaveFrom.net Helper removed). **Framing-sensitive** — same tech survived
   under different descriptions. There was no Google-announced general "video downloader ban."

## Extensions that survived (and why)
| Extension | CWS users | Framing | Why it survived |
|---|---|---|---|
| Video DownloadHelper | 5M | "Download videos… no tracking"; **excludes YouTube** | 10-yr brand; excludes YT; general tool; MV3 |
| The Stream Detector | 40k | "Detects playlists… assembles commands" | **Developer Tools** category; detection only, no DL |
| The Stream Detector PLUS | 3k | + mpv commands | same dev-tool framing |
| M3U8 Player | 3k | "Transforms your browser into an M3U8/HLS player" | **player** framing, not downloader |
| m3u8 Sniffer TV | — | detection + in-page playback | not a download tool |

**Survival pattern:** (a) MV3, (b) doesn't claim YouTube/DRM download, (c) frames as
detection/dev-tool or in-browser player (not "ripper"), (d) explicitly disclaims unauthorized use.
CWS does **not** feature video-downloader extensions in discovery → list under **Developer Tools**.

## Firefox AMO — more permissive
Mozilla's add-on policies contain **no explicit prohibition** on video/HLS/streaming tools (only
general legal-compliance). Multiple explicit "HLS downloader" extensions are live with thousands
of users (puemos HLS Downloader 15.7k; Video DownloadHelper 1.84M with a "Recommended" badge).
**Self-distribution** of a signed `.xpi` is fully supported (unlisted channel via `web-ext sign`
/ AMO API): all FF extensions must be Mozilla-signed, served with
`Content-Type: application/x-xpinstall`, installable via a direct link; subject to manual review
at any time; updates via `update_url`. List publicly on AMO (auto-updates + trust) and offer
the `.xpi` for advanced users.

## Edge Add-ons
Policy language nearly identical to CWS (copied), but **lighter enforcement in practice** —
multiple explicit downloaders live. Submit the same Chromium package as a secondary channel.

## Chrome sideload reality (.crx outside the store)
Chrome **auto-disables** sideloaded `.crx` (grays out, "not listed… may have been added without
your knowledge," can't re-enable) — enforced since Chrome 33, no end-user workaround without
enterprise policy. "Load unpacked" works but needs Developer Mode + manual folder selection +
shows a startup warning → developers/enthusiasts only (~1–5% of potential users), no auto-update.
Enterprise force-install is irrelevant for consumers.

## Framing analysis (same tech, 3 outcomes)
- **A — "curated sports piracy tool"** → instant removal everywhere.
- **B — "HLS downloader / stream ripper"** → high CWS risk, moderate AMO risk.
- **C — "HLS Stream Detector & In-Browser Player / Developer Tool"** → substantially lower CWS
  risk; low on AMO/Edge. Emphasize detection (passive), in-browser playback (not download to
  disk), developer/debugging use, explicit no-YouTube/no-DRM, responsibility disclaimer. CWS
  reviewers treat "plays a stream in the browser" ≠ "downloads copyrighted media."
**No "save to disk" primary feature** keeps you further from the line than a downloader.

## Native messaging (mpv/VLC handoff)
Documented + permitted. Examples on CWS ("Streamlink Handoff," "Open in VLC"). **Neutral-to-
slightly-positive** for acceptability — the extension just passes a URL string to a user-installed
app (like a hyperlink). Frame the host as a general media-player launcher. Adds install friction →
power-user option, not default.

## Ranked distribution plan (max reach, free)
**Tier 1:** (1) **Firefox AMO** (most permissive; ceiling shown by Video DownloadHelper's 1.84M
FF users) · (2) **Chrome Web Store** (2–3B users; survives with Developer-Tools detector/player
framing) · (3) **Microsoft Edge** (zero extra porting; lighter review).
**Tier 2:** (4) **GitHub Releases** + "load unpacked" (dev/enthusiast; fallback if removed) ·
(5) **Firefox self-distributed signed `.xpi`** (one-click install link).
**Tier 3:** Safari (Xcode + $99/yr + notarization); Opera/Brave/Vivaldi (install from CWS directly).

## Critical framing choices
Title "…Detector & Player" (not "Downloader/Ripper"); CWS category **Developer Tools**; explicit
"does not support YouTube or DRM-protected content"; no download-to-disk primary feature; verbatim
disclaimer "Users are solely responsible for ensuring they have authorization…"; native messaging
framed as "open in your local media player"; AMO public listing targeting "Recommended";
open-source (MIT) for trust.

## Adversarial corrections
- "2025 Chrome purge of downloaders" — PARTIALLY TRUE (mostly MV2 EOL, not a targeted anti-piracy
  wave). - "AMO prohibits HLS downloaders" — FALSE (many live). - "You can distribute a Chrome
  `.crx` outside the store" — FALSE in practice (auto-disabled; only "load unpacked" works).

## Sources
developer.chrome.com/docs/webstore/program-policies (+ malicious-and-prohibited, cws-policy-
updates-2025) · extensionworkshop.com (self-distribution, signing) · learn.microsoft.com edge
developer-policies · developer.chrome.com native-messaging · CWS/AMO listings for The Stream
Detector, Video DownloadHelper, puemos HLS Downloader · developer.chrome.com resuming-transition-mv3.
