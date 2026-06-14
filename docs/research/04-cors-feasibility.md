# Research 04 — CORS feasibility: why a pure web app fails / the extension wins

> Verbatim research report. Can a pure client-side web app (no backend) play arbitrary pirate-
> sports HLS streams a user pastes in? Evidence-based verdict across 7 angles.

## Foundational logic
When a pirate site embeds a player in an iframe, that iframe's JS fetches the `.m3u8` cross-origin
→ the CDN **must** send `Access-Control-Allow-Origin` covering the embed origin, or the browser
blocks it. So CORS is either wildcard or scoped to that embed domain. Your web app at a *different*
origin is a different case.

## Angle 1 — Do these CDNs send `ACAO: *` or a locked origin?
Split, leaning locked/absent:
- **Pattern A — `ACAO: *`** (lazy-open; rotating domains can't whitelist). Direct client-side
  fetch works. ~20–35%.
- **Pattern B — specific origin lock.** Your web app gets CORS-blocked. ~30–40%.
- **Pattern C — no CORS headers.** Works for non-browser clients (mpv/VLC) but blocks browser
  fetch entirely. ~25–40%.
With `withCredentials:true`, `ACAO:*` is forbidden by spec → some break that combination.

## Angle 2 — Referer/token enforcement
- **Token-in-URL expiry** is near-universal (`?token=…&expires=…` → 403 after a few hours).
- **Referer checking** is common, on manifest AND segments. A browser's JS **cannot** override
  `Referer` (forbidden header) → your app sends its own origin, not the embed's. Hard wall.
- **User-Agent:** a real browser web app sends a real UA automatically — a genuine advantage over
  mpv/streamlink (which get UA-blocked). But it doesn't help with Referer/token/origin-locked CORS.

## Angle 3 — Public CORS proxies (corsproxy.io, allOrigins, …)
Technically possible, **practically useless for live video**: 720p ≈ 1–3 Mbps → 0.45–1.35 GB per
viewer-hour. These services are dev-only/text-only, rate-limited, no SLA, would throttle/block
immediately. **Non-starters for video.**

## Angle 4 — Serverless/edge proxy (Cloudflare Workers, Vercel, Deno Deploy)
- **Cloudflare Workers:** ToS **prohibits streaming video** through their bandwidth; manifest-only
  text passes under the radar, full segment proxying triggers enforcement. 100k req/day free.
- **Vercel Hobby:** 100 GB/mo egress ÷ 1 Mbps ≈ one match for one viewer exhausts it. Infeasible
  for full proxying.
- **Deno Deploy:** ~100 GB/mo — same math.
Full segment proxying free-tier = infeasible (ToS or bandwidth). **Manifest-only is different** —
manifest is ~2–10 KB text, so 1M/mo ≈ ~10 GB.

## Angle 5 — Manifest-only proxy hybrid (the sweet spot)
Edge function fetches the manifest server-side (injecting Referer), serves it with `ACAO:*`, and
**leaves segment URLs as absolute CDN URLs** → the browser fetches segments **directly**. Works iff
segments have `ACAO:*` and segments aren't Referer-gated. Bandwidth = tiny text → effectively free
at small scale; no video-bytes ToS issue. Fails if segments are Referer-gated (browser sends your
origin). Precedent: warren-bank/HLS-Proxy, mhdzumair/mediaflow-proxy, MetaHat/m3u8-proxy.

## Angle 6 — Other client-side tricks
- **Service workers:** can rewrite *manifests* (text) but a cross-origin segment fetch with no
  CORS returns an **opaque response** — unreadable, can't feed MSE. **Do not bypass CORS for
  segments.**
- **Iframe-embed the original player:** X-Frame-Options/CSP `frame-ancestors` block most; cross-
  origin iframe is uncontrollable. Dead end for an app.
- **`no-cors` fetch:** opaque, unusable with MSE.
- **hls.js `xhrSetup`/`fetchSetup`:** cannot set forbidden headers (Referer/Origin/Cookie).

## Angle 7 — What do existing online m3u8 players do?
Pure client-side ones (hlsplayer.net, Castr, livepush) **fail on CORS-blocked URLs** and tell you
to "enable CORS on your server." The ones that work (anym3u8player.com, m3u8-player.net) use a
**server-side proxy** (PHP/Node). mediaflow-proxy/MetaHat are the OSS proxies (need a server).

## Verdicts
- **Pure client-side web app plays ~20–30%** of pirate-sports streams directly (ACAO:* on manifest
  + segments). UX = "try the URL — works or CORS error."
- **70–80% need** server-side Referer injection / full proxy (and that's redistribution).
- **Manifest-only proxy** is the cheapest no-video-bytes path but only covers the subset with
  CORS-open segments + no segment Referer check.
- **No client-side trick bypasses CORS for segments** (opaque responses can't feed MSE).

→ This is the core argument for the **extension**: an extension page with `host_permissions`
bypasses CORS and injects Referer via DNR/webRequest — **no server, no bandwidth, no
redistribution** — covering the streams a web app can't.

## Sources
news.ycombinator.com (HLS proxy / Referer+UA on playlist+segments) · mux.com/blog/service-workers
· mmazzarolo.com service-workers-and-cors · developers.cloudflare.com (workers pricing, video
policy) · vercel.com/docs/limits · deno.com/deploy/pricing · github.com/MetaHat/m3u8-proxy ·
github.com/warren-bank/HLS-Proxy · github.com/mhdzumair/mediaflow-proxy · anym3u8player.com FAQ ·
hlsplayer.net · m3u8-player.net troubleshooting · hls.js issue #1068.
