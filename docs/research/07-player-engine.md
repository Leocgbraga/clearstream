# Research 07 — Player engine (hls.js config, ENDLIST live-ify, header injection, failover)

> Verbatim research report. Two premise corrections: **DNR `set` works on Referer/Cookie** (only
> `append` has an allowlist); **stripping `#EXT-X-ENDLIST` is necessary but NOT sufficient** —
> hls.js only keeps polling if the window actually advances (media-sequence increments). A static
> re-served manifest stalls.

## 1. hls.js setup
- **Use the FULL `hls.min.js`**, not light. Light drops alt-audio + subtitle/EME handling; sports
  streams routinely carry alternate audio. Bundle-size win is irrelevant when shipped inside the
  extension. Light's exclusion list isn't formally documented → another reason to avoid relying on it.
- **No remote code** (store rule): vendor `hls.min.js`, load via `<script src="hls.min.js">`. No CDN, no eval.
- **Worker + MV3 CSP:** `enableWorker:true` spins a Blob-URL worker → the page CSP must allow
  `worker-src 'self' blob:` (keep `script-src 'self'`). If blocked, `enableWorker:false` (main-thread demux).

Recommended config (defaults from API.md; tuning for flaky live CDNs):
```js
new Hls({
  enableWorker:true,
  lowLatencyMode:false,            // OFF: LL-HLS partials fight ENDLIST rewriting; these aren't real LL-HLS
  liveSyncDurationCount:3, liveMaxLatencyDurationCount:Infinity,
  liveDurationInfinity:true,       // set dynamically (only for genuine live; else infinite seekbar)
  backBufferLength:90,
  maxBufferLength:30, maxMaxBufferLength:600,
  manifestLoadingMaxRetry:4, manifestLoadingRetryDelay:500,  // first manifest often 403s until DNR warms
  levelLoadingMaxRetry:6, fragLoadingMaxRetry:8, fragLoadingRetryDelay:1000,
  startLevel:-1, capLevelToPlayerSize:true, capLevelOnFPSDrop:true,
  abrEwmaDefaultEstimate:1_000_000, startPosition:-1
});
```

Attach + native fallback:
```js
if (Hls.isSupported()) { const hls=new Hls(config); hls.loadSource(url); hls.attachMedia(video);
  hls.on(Hls.Events.MANIFEST_PARSED,()=>video.play().catch(()=>{})); return hls; }
else if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src=url; return null; } // Safari: NO loader hook
```

ABR UI: `hls.levels`, `hls.currentLevel` (-1=Auto), `hls.nextLevel`, `hls.autoLevelEnabled`;
build menu on `MANIFEST_PARSED`; reflect ABR via `LEVEL_SWITCHED`.

Errors: v1 hls.js self-heals non-fatal; you handle **fatal** only:
```js
hls.on(Hls.Events.ERROR,(_e,d)=>{ if(!d.fatal) return;
  switch(d.type){
    case Hls.ErrorTypes.NETWORK_ERROR: hls.startLoad(); scheduleFailover(d); break;
    case Hls.ErrorTypes.MEDIA_ERROR: /* recoverMediaError(); 2nd time → swapAudioCodec()+recover */ break;
    default: hls.destroy(); scheduleFailover(d);
  }});
```
`BUFFER_STALLED_ERROR` (after nudge retries) is the primary **stall** failover signal.

## 2. Header injection
**Cookie via jar:** if the cookie is a real site cookie for the CDN host, don't touch it — set
`xhrSetup: xhr=>{xhr.withCredentials=true}` / `fetchSetup:(c,i)=>{i.credentials='include';return new
Request(c.url,i)}`. With host_permissions, cross-origin fetches attach jar cookies.
**Referer/UA/captured-cookie via DNR `modifyHeaders`** (`set` has no allowlist):
```js
chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds:[ID], addRules:[{
  id:ID, priority:1,
  condition:{ tabIds:[playerTabId], requestDomains:[streamHost], resourceTypes:['xmlhttprequest','media'] },
  action:{ type:'modifyHeaders', requestHeaders:[
    {header:'referer',operation:'set',value:referer},
    {header:'cookie',operation:'set',value:cookie},
    {header:'user-agent',operation:'set',value:ua} ]} }]});
```
**Scoping:** prefer **session rules + `tabIds:[playerTabId]`** (precise, auto-expiring, dodges the
opaque-initiator bug). `initiatorDomains:[chrome.runtime.id]` works for extension-page requests but
has null/opaque-initiator edge cases (sandboxed iframe / worker / SW fetch) — keep as fallback.
`tabIds` is **session-rules-only**. Host permission for the CDN is required for `modifyHeaders` to act.
**Cannot set `Origin`/`Sec-Fetch-*`** → Origin-pinned CDNs unplayable.
**Firefox:** blocking `webRequest.onBeforeSendHeaders` (retained in FF MV3) — compute headers per
request; `['blocking','requestHeaders']`; scope by `details.tabId`/`originUrl`.

## 3. ENDLIST live-ify — robustly (custom pLoader, NOT a blob)
Stripping ENDLIST only helps if upstream is a genuine rolling window (media-sequence increments on
each poll — these CDNs do that). **One-shot blob fails:** hls.js re-polls the immutable blob → no
new segments → stall. Rewrite on **every** poll via a custom `pLoader`:
```js
function makeLive(t){ return t.replace(/^#EXT-X-ENDLIST\s*$/gm,'').replace(/^#EXT-X-PLAYLIST-TYPE:\s*VOD\s*$/gm,''); }
class LivePLoader extends Hls.DefaultConfig.loader {
  constructor(c){ super(c); const load=this.load.bind(this);
    this.load=(ctx,cfg,cb)=>{ if(ctx.type==='manifest'||ctx.type==='level'){    // BOTH — 'level' is what re-polls
        const ok=cb.onSuccess; cb.onSuccess=(r,s,c2,n)=>{ if(typeof r.data==='string') r.data=makeLive(r.data); ok(r,s,c2,n); }; }
      load(ctx,cfg,cb); }; } }
new Hls({ pLoader:LivePLoader, liveDurationInfinity:true, lowLatencyMode:false });
```
**Liveness guard:** track `#EXT-X-MEDIA-SEQUENCE` across the first two `level` loads; if it doesn't
advance within ~2×targetduration, it's genuine VOD → don't strip ENDLIST, `liveDurationInfinity:false`.
SW-intercept variant works too (needed for native HLS / Firefox) but MV3 SW non-persistence makes it
fragile → pLoader is default. Header injection stays in DNR/jar (loader can't set forbidden headers);
you rarely need a custom `fLoader`.

## 4. CORS from the player page
Extension page (`chrome-extension://`) with `host_permissions` for the CDN can `fetch`/XHR cross-
origin **without** ACAO — manifest + every segment readable. hls.js default loader inherits this.
Watch for segments on a different host than the manifest → add both to host_permissions +
`requestDomains`. **Still fails:** Origin-validation CDNs (can't forge Origin), token/HMAC-signed
short-TTL segment URLs, `Sec-Fetch` enforcement, mTLS/IP-locked.

## 5. UX + auto-failover
PiP (`video.requestPictureInPicture()`), fullscreen (container), persisted volume
(`storage.local`), keyboard (Space/k, f, p, m, l→Auto, ↑↓ volume, → "Go Live" via
`hls.liveSyncPosition`). **Failover = in-browser port of `player.py`:**
```js
const DEGRADED_STREAK=5, MIN_PLAY_MS=8000;   // === _DEGRADED_STREAK / _MIN_PLAY_SECS
hls.on(Hls.Events.FRAG_LOADED,()=>stalls=0);                          // healthy reset
hls.on(Hls.Events.ERROR,(_e,d)=>{ if(d.details===Hls.ErrorDetails.BUFFER_STALLED_ERROR && ++stalls>=3) scheduleFailover('stall'); });
// progress watchdog every 2s: if !paused && readyState>=2 && currentTime<=lastT+0.05 → stalls++ ; >=4 → failover
```
`scheduleFailover` mirrors `play_multi`: if `now-playStart<MIN_PLAY_MS` mark current "bad capture"
(don't count as ever-worked); `hls.destroy()`; advance idx; request host perm for next CDN if
different; rebuild. Surface *why* in an ARIA-live strip; manual source-pin dropdown = escape hatch.
Cap `startLoad()` retries before failover (don't hammer the CDN).

## What won't play
DRM; Origin-validated CDNs; per-request signed/short-TTL segment URLs; genuine VOD wrongly
ENDLIST-stripped (mitigated by liveness check); segments on an uncovered host; native-HLS-only
contexts (no loader hook → can't strip/inject); non-HLS (DASH/RTMP/WebRTC); LL-HLS if you force
`lowLatencyMode:false` (plays at higher latency).

## Sources
github.com/video-dev/hls.js/blob/master/docs/API.md · hls.js issues #2351, #5777, #4463 ·
eyevinntechnology.medium.com HLS manifest manipulation + github.com/Eyevinn/hls-vodtolive ·
developer.chrome.com declarativeNetRequest · chromium-extensions groups (initiatorDomains:[runtime.id])
· MDN webRequest.onBeforeSendHeaders · blog.mozilla.org FF MV3 blocking webRequest · developer.chrome.com offscreen.
