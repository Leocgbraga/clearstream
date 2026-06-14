// Local fixture server for the real-target verification harness (WS3). Dependency-free (Node http).
// It replicates the hostile HLS delivery/concealment patterns that ad-heavy streaming aggregators use,
// so scripts/verify-fixtures.mjs can drive the real extension against them deterministically — no
// external/live stream needed, and every failure mode is reproducible in CI.
//
// Origins (different ports = different origins, for same-origin-policy / cross-iframe tests):
//   3100 pages · 3101/3102 extra iframe origins · 8787 CDN (manifests+segments) · 8788 ad/redirect
//
// CDN routes:
//   /vendor/hls.min.js                      bundled hls.js (served from node_modules) for fixtures
//   /seg/<file>.ts                          open segment (CORS-open)
//   /open/{lo,hi}.m3u8  /open/master.m3u8   open media / master playlists (CORS-open)
//   /open/live.m3u8                         rolling-window LIVE playlist (no ENDLIST)
//   /noext/stream                           a media playlist served by content-type only (no .m3u8 ext)
//   /api/config.json                        a JSON API whose body embeds the .m3u8 URL
//   /gated/<referer|origin|token|cookie>/manifest.m3u8 (+ /seg/<file>.ts)  gated (403 without the right
//                                           header/param; NO CORS header — needs the extension to replay)
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const MEDIA = path.join(DIR, 'media');
const ROOT = path.resolve(DIR, '..', '..');

export const PORTS = { pages: 3100, frame1: 3101, frame2: 3102, cdn: 8787, ad: 8788 };
const CDN = `http://localhost:${PORTS.cdn}`;
const PAGES = `http://localhost:${PORTS.pages}`;
const FRAME1 = `http://localhost:${PORTS.frame1}`;
const FRAME2 = `http://localhost:${PORTS.frame2}`;
const AD = `http://localhost:${PORTS.ad}`;

const SEGS = { lo: ['lo_0.ts', 'lo_1.ts', 'lo_2.ts', 'lo_3.ts'], hi: ['hi_0.ts', 'hi_1.ts', 'hi_2.ts', 'hi_3.ts'] };
const DUR = 2;
const START = 1_700_000_000_000; // fixed epoch base (Date.now allowed here — this is a test server, not a workflow)

const HLS_DIST = ['hls.min.js', 'hls.js']
  .map((f) => path.join(ROOT, 'node_modules', 'hls.js', 'dist', f))
  .find((p) => existsSync(p));

// ---- manifest builders -------------------------------------------------------
function mediaPlaylist(rendition, { live = false, segBase } = {}) {
  const segs = SEGS[rendition] ?? SEGS.lo;
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', `#EXT-X-TARGETDURATION:${DUR}`];
  if (live) {
    // Rolling window of 3, cycling the committed segments with an advancing media-sequence + a
    // cache-buster so hls.js treats each as new → currentTime keeps advancing (true live behaviour).
    const seq = Math.floor((Date.now() - START) / (DUR * 1000));
    lines.push(`#EXT-X-MEDIA-SEQUENCE:${seq}`);
    for (let i = 0; i < 3; i++) {
      const n = seq + i;
      lines.push(`#EXTINF:${DUR}.0,`, `${segBase}/${segs[n % segs.length]}?s=${n}`);
    }
    // no #EXT-X-ENDLIST → live
  } else {
    lines.push('#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-PLAYLIST-TYPE:VOD');
    for (const s of segs) lines.push(`#EXTINF:${DUR}.0,`, `${segBase}/${s}`);
    lines.push('#EXT-X-ENDLIST');
  }
  return lines.join('\n') + '\n';
}

function masterPlaylist(base) {
  return [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=256x144',
    `${base}/lo.m3u8`,
    '#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=426x240',
    `${base}/hi.m3u8`,
    '',
  ].join('\n');
}

// ---- fixture pages (one per concealment pattern in the catalog) ---------------
const M3U8 = `${CDN}/open/master.m3u8`;
const LO = `${CDN}/open/lo.m3u8`;

const doc = (title, body, headExtra = '') =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${headExtra}</head><body>${body}</body></html>`;
const hls = `<script src="${CDN}/vendor/hls.min.js"></script>`;

const FIXTURES = {
  // --- A. manifest surfacing / concealment ---
  'plain-video': () => doc('plain-video', `<video controls src="${LO}"></video><video><source src="${M3U8}"></video>`),
  'hls-string': () =>
    doc('hls-string', `<video id=v></video>${hls}<script>new Hls().loadSource(${JSON.stringify(M3U8)});</script>`),
  blob: () =>
    doc(
      'blob',
      `<video id=v></video><script>fetch(${JSON.stringify(LO)}).then(r=>r.text()).then(t=>{const b=new Blob([t],{type:'application/vnd.apple.mpegurl'});document.getElementById('v').src=URL.createObjectURL(b);});</script>`,
    ),
  'json-embedded': () =>
    doc(
      'json-embedded',
      `<div id=p></div><script>fetch(${JSON.stringify(`${CDN}/api/config.json`)}).then(r=>r.json()).then(j=>{window.__cfg=j;});</script>`,
    ),
  obfuscated: () =>
    doc(
      'obfuscated',
      `<script>var a=['${CDN}','/open','/mas','ter.m','3u8'];fetch(a[0]+a[1]+'/'+a.slice(2).join(''));</script>`,
    ),
  'fetch-only': () => doc('fetch-only', `<script>fetch(${JSON.stringify(M3U8)});</script>`),
  'xhr-only': () =>
    doc('xhr-only', `<script>var x=new XMLHttpRequest();x.open('GET',${JSON.stringify(LO)});x.send();</script>`),
  'document-write': () =>
    doc('document-write', `<script>document.write('<video src="'+${JSON.stringify(LO)}+'"></video>');</script>`),
  // Known gap: a manifest with no .m3u8 in its URL, identified by content-type only. The current
  // detector keys on the .m3u8 URL pattern, so this is an EXPECTED MISS (the onHeadersReceived
  // content-type net is the documented future fix). The harness asserts it is NOT detected.
  'no-ext': () => doc('no-ext', `<script>fetch(${JSON.stringify(`${CDN}/noext/stream`)});</script>`),

  // --- C. iframe nesting ---
  'iframe-cross-origin': () => doc('iframe-cross-origin', `<iframe src="${FRAME1}/fixtures/_leaf?u=${encodeURIComponent(LO)}"></iframe>`),
  'iframe-sandboxed': () => doc('iframe-sandboxed', `<iframe sandbox="allow-scripts" src="${FRAME1}/fixtures/_leaf?u=${encodeURIComponent(LO)}"></iframe>`),
  'iframe-srcdoc': () =>
    doc('iframe-srcdoc', `<iframe sandbox="allow-scripts" srcdoc="${`<script>fetch('${LO}')<\/script>`.replace(/"/g, '&quot;')}"></iframe>`),
  'iframe-3-deep': () => doc('iframe-3-deep', `<iframe src="${FRAME1}/fixtures/_nest?d=2&u=${encodeURIComponent(LO)}"></iframe>`),

  // --- D. anti-inspection ---
  // The page records the original fetch and later checks if it was monkeypatched. Detection must still
  // work (it does — the hook catches the URL); the harness logs that such a page CAN observe the patch.
  'monkeypatch-detect': () =>
    doc(
      'monkeypatch-detect',
      `<script>window.__origFetch=window.fetch;</script><script>fetch(${JSON.stringify(M3U8)});setTimeout(()=>{window.__patched=(window.fetch!==window.__origFetch);},50);</script>`,
    ),
  overlay: () =>
    doc(
      'overlay',
      `<div style="position:fixed;inset:0;opacity:.01;z-index:9999"><a href="${AD}/ad" target="_blank">x</a></div><script>fetch(${JSON.stringify(M3U8)});</script>`,
    ),

  // Positive control: this page (origin :3100) plays the Referer-gated stream via hls.js — its own
  // requests carry Referer: http://localhost:3100, so the gate passes. Proves the stream + gate are
  // real, which is what makes the extension-player negative (no Referer → blocked) meaningful.
  'gated-referer-play': () =>
    doc(
      'gated-referer-play',
      `<video id=v muted></video>${hls}<script>var h=new Hls();h.loadSource(${JSON.stringify(`${CDN}/gated/referer/manifest.m3u8`)});h.attachMedia(document.getElementById('v'));h.on(Hls.Events.MANIFEST_PARSED,function(){document.getElementById('v').play();});</script>`,
    ),

  // --- helpers used by the iframe fixtures (served from any origin) ---
  _leaf: () => doc('_leaf', `<script>var u=new URLSearchParams(location.search).get('u');if(u)fetch(u);</script>`),
  _nest: () =>
    doc(
      '_nest',
      `<script>var p=new URLSearchParams(location.search);var d=+(p.get('d')||0);var u=p.get('u');var F=[${JSON.stringify(FRAME1)},${JSON.stringify(FRAME2)}];if(d>0){var f=document.createElement('iframe');f.src=F[d%2]+'/fixtures/'+(d-1>0?'_nest':'_leaf')+'?d='+(d-1)+'&u='+encodeURIComponent(u);document.body.appendChild(f);}else{fetch(u);}</script>`,
    ),
};

// ---- gating ------------------------------------------------------------------
function gateOk(type, req, url) {
  const h = req.headers;
  if (type === 'referer') return (h.referer ?? '').startsWith(PAGES);
  if (type === 'origin') return h.origin === PAGES || (h.referer ?? '').startsWith(PAGES);
  if (type === 'cookie') return /(?:^|;\s*)cs_session=/.test(h.cookie ?? '');
  if (type === 'token') {
    const u = new URL(url, CDN);
    const exp = Number(u.searchParams.get('exp'));
    return u.searchParams.get('token') === 'good' && Number.isFinite(exp) && exp > Date.now();
  }
  return false;
}

// ---- request handler (shared by all ports) -----------------------------------
function send(res, status, type, body, { cors = false, extra = {} } = {}) {
  const headers = { 'content-type': type, 'cache-control': 'no-store', ...extra };
  if (cors) headers['access-control-allow-origin'] = '*';
  res.writeHead(status, headers);
  res.end(body);
}

function handler(req, res) {
  let url;
  try {
    url = new URL(req.url, CDN);
  } catch {
    return send(res, 400, 'text/plain', 'bad url');
  }
  const p = url.pathname;

  if (p === '/vendor/hls.min.js') {
    if (!HLS_DIST) return send(res, 404, 'text/plain', 'hls.js not found');
    return send(res, 200, 'text/javascript', readFileSync(HLS_DIST), { cors: true });
  }
  // open segments
  let m = p.match(/^\/seg\/([\w.-]+\.ts)$/);
  if (m && existsSync(path.join(MEDIA, m[1]))) {
    return send(res, 200, 'video/mp2t', readFileSync(path.join(MEDIA, m[1])), { cors: true });
  }
  // open manifests
  if (p === '/open/lo.m3u8') return send(res, 200, 'application/vnd.apple.mpegurl', mediaPlaylist('lo', { segBase: `${CDN}/seg` }), { cors: true });
  if (p === '/open/hi.m3u8') return send(res, 200, 'application/vnd.apple.mpegurl', mediaPlaylist('hi', { segBase: `${CDN}/seg` }), { cors: true });
  if (p === '/open/live.m3u8') return send(res, 200, 'application/vnd.apple.mpegurl', mediaPlaylist('lo', { live: true, segBase: `${CDN}/seg` }), { cors: true });
  if (p === '/open/master.m3u8') return send(res, 200, 'application/vnd.apple.mpegurl', masterPlaylist(`${CDN}/open`), { cors: true });
  // manifest by content-type only (no .m3u8 extension)
  if (p === '/noext/stream') return send(res, 200, 'application/vnd.apple.mpegurl', mediaPlaylist('lo', { segBase: `${CDN}/seg` }), { cors: true });
  // a JSON API whose body embeds the stream URL
  if (p === '/api/config.json') return send(res, 200, 'application/json', JSON.stringify({ title: 'x', stream: M3U8 }), { cors: true });

  // gated manifests + segments (NO cors header — needs the extension to replay the right header)
  m = p.match(/^\/gated\/(referer|origin|token|cookie)\/(manifest\.m3u8|seg\/[\w.-]+\.ts)$/);
  if (m) {
    const [, type, rest] = m;
    if (!gateOk(type, req, req.url)) return send(res, 403, 'text/plain', 'forbidden');
    if (rest === 'manifest.m3u8') {
      return send(res, 200, 'application/vnd.apple.mpegurl', mediaPlaylist('lo', { segBase: `${CDN}/gated/${type}/seg` }), { cors: true });
    }
    const file = rest.slice('seg/'.length);
    if (existsSync(path.join(MEDIA, file))) return send(res, 200, 'video/mp2t', readFileSync(path.join(MEDIA, file)), { cors: true });
    return send(res, 404, 'text/plain', 'no seg');
  }

  // fixture pages
  m = p.match(/^\/fixtures\/([\w-]+)$/);
  if (m && FIXTURES[m[1]]) return send(res, 200, 'text/html', FIXTURES[m[1]](url.search));

  // ad / redirect stub (any path on the ad port lands here too)
  if (p === '/ad' || p === '/') return send(res, 200, 'text/html', doc('ad', '<h1>ad</h1>'));

  return send(res, 404, 'text/plain', 'not found');
}

// ---- lifecycle ---------------------------------------------------------------
export function startFixtureServer() {
  const servers = Object.values(PORTS).map((port) => {
    const s = createServer(handler);
    s.listen(port, 'localhost');
    return s;
  });
  return {
    urls: { CDN, PAGES, FRAME1, FRAME2, AD },
    fixtureUrl: (name) => `${PAGES}/fixtures/${name}`,
    close: () => Promise.all(servers.map((s) => new Promise((r) => s.close(r)))),
  };
}

// Allow `node server.mjs` for manual poking.
if (import.meta.url === `file://${process.argv[1]}`) {
  startFixtureServer();
  console.log(`fixture server up: ${PAGES}/fixtures/plain-video  ·  ${CDN}/open/master.m3u8`);
}
