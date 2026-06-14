// Real-target verification harness (WS3). Drives the built extension + its real deep-capture hook
// against the local hostile-pattern fixtures (tests/fixtures/server.mjs), so we have deterministic,
// CI-able proof the detector + player work on the kinds of streams ClearStream targets — without
// depending on a live/pirated stream. Three parts:
//   1. DETECTION MATRIX — for each concealment pattern, the actual built deep-capture hook
//      (content-scripts/deep-main.js, injected exactly as the extension runs it) + the activeTab DOM
//      scan must find the .m3u8 (or, for the documented no-ext gap, must NOT).
//   2. PLAYBACK — the real player page plays a VOD master (renditions), a rolling LIVE playlist
//      (currentTime keeps advancing → the ENDLIST live-ify path), and fails over a dead mirror.
//   3. GATING — a Referer-gated stream plays in-page (gate is real) but the extension player can't
//      load it without injection (proves injection is needed); on-wire injection itself is unit- +
//      DNR-rule-verified (host-permission grant can't be auto-accepted in headless Playwright).
//
// Run: pnpm verify:fixtures   (builds chrome-mv3 first, then this).
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { startFixtureServer } from '../tests/fixtures/server.mjs';

const ext = path.resolve('.output/chrome-mv3');
if (!existsSync(ext)) {
  console.error('No .output/chrome-mv3 — run `pnpm build` first.');
  process.exit(1);
}
const deepMainSrc = readFileSync(path.join(ext, 'content-scripts/deep-main.js'), 'utf8');

// Collect every {__clearstream__:'stream'} the hook posts, in whatever frame it fires.
const COLLECTOR =
  "window.__cs_finds__=window.__cs_finds__||[];addEventListener('message',function(e){try{var d=e.data;if(d&&d.__clearstream__==='stream'&&d.url)window.__cs_finds__.push(d.url);}catch(_){}}); ";
// The activeTab DOM/Performance scan the extension runs for non-fetch patterns (mirrors background.ts scanPage).
const DOM_SCAN =
  "(function(){var re=/\\.m3u8(\\?|#|$)/i;var out=window.__cs_finds__||(window.__cs_finds__=[]);try{for(var e of performance.getEntriesByType('resource'))if(re.test(e.name))out.push(e.name);}catch(_){}document.querySelectorAll('video,source').forEach(function(el){var s=el.src||el.currentSrc||el.getAttribute('src')||'';if(s&&re.test(s))out.push(s);});})();";

const isM3u8 = (u) => /\.m3u8(\?|#|$)/i.test(u);

async function findsAcrossFrames(page) {
  const all = [];
  for (const f of page.frames()) {
    try {
      const arr = await f.evaluate(() => window.__cs_finds__ || []);
      if (Array.isArray(arr)) all.push(...arr);
    } catch {
      /* frame gone / inaccessible */
    }
  }
  return all;
}

// name · whether detection is expected · whether to also run the DOM scan · optional note
const DETECT_CASES = [
  { name: 'plain-video', expect: true, dom: true },
  { name: 'hls-string', expect: true },
  { name: 'blob', expect: true },
  { name: 'json-embedded', expect: true },
  { name: 'obfuscated', expect: true },
  { name: 'fetch-only', expect: true },
  { name: 'xhr-only', expect: true },
  { name: 'document-write', expect: true, dom: true },
  { name: 'no-ext', expect: false, note: 'documented gap: no .m3u8 in URL → needs the planned onHeadersReceived content-type net' },
  { name: 'iframe-cross-origin', expect: true },
  { name: 'iframe-sandboxed', expect: true },
  { name: 'iframe-srcdoc', info: true, note: 'opaque-origin frame — extension now covers it via match_origin_as_fallback; the harness addInitScript cannot drive srcdoc, so this row is informational' },
  { name: 'iframe-3-deep', expect: true },
  { name: 'monkeypatch-detect', expect: true, note: 'detected fine; such a page CAN observe fetch was patched (deep-main replaces it by reference)' },
  { name: 'overlay', expect: true },
];

const srv = startFixtureServer();
const { CDN } = srv.urls;
const results = { detect: [], playback: {}, gating: {} };

const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});

try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = sw.url().split('/')[2];
  console.log('extension id:', extId);

  // ---- PART 1: detection matrix ----
  for (const c of DETECT_CASES) {
    const page = await ctx.newPage();
    await page.addInitScript(COLLECTOR);
    await page.addInitScript({ content: deepMainSrc }); // the REAL built hook, run as the extension runs it
    await page.goto(srv.fixtureUrl(c.name), { waitUntil: 'load' }).catch(() => {});
    await page.waitForTimeout(2500); // let fetches + nested cross-origin iframes resolve
    if (c.dom) for (const f of page.frames()) await f.evaluate(DOM_SCAN).catch(() => {});
    const finds = await findsAcrossFrames(page);
    const matched = finds.some(isM3u8);
    results.detect.push({ name: c.name, expect: c.expect, matched, info: !!c.info, ok: c.info ? null : matched === c.expect, note: c.note });
    await page.close();
  }

  // ---- PART 2: playback / live-ify / failover (real player, CORS-open CDN) ----
  // VOD master → real decode + 2 renditions populated.
  {
    const p = await ctx.newPage();
    await p.goto(`chrome-extension://${extId}/player.html#src=${encodeURIComponent(`${CDN}/open/master.m3u8`)}`);
    await p
      .waitForFunction(() => { const v = document.querySelector('video'); return !!v && v.readyState >= 3 && v.currentTime > 0; }, { timeout: 30000 })
      .catch(() => {});
    const info = await p.evaluate(() => { const v = document.querySelector('video'); return { ct: v?.currentTime ?? 0, rends: v?.videoRenditions?.length ?? 0 }; });
    results.playback.vod = { ok: info.ct > 0 && info.rends > 0, ...info };
    await p.close();
  }
  // LIVE rolling playlist → currentTime must KEEP advancing (proves the ENDLIST live-ify pLoader).
  {
    const p = await ctx.newPage();
    await p.goto(`chrome-extension://${extId}/player.html#src=${encodeURIComponent(`${CDN}/open/live.m3u8`)}`);
    await p.waitForFunction(() => (document.querySelector('video')?.currentTime ?? 0) > 0, { timeout: 30000 }).catch(() => {});
    const t1 = await p.evaluate(() => document.querySelector('video')?.currentTime ?? 0);
    await p.waitForTimeout(4000);
    const t2 = await p.evaluate(() => document.querySelector('video')?.currentTime ?? 0);
    results.playback.live = { ok: t1 > 0 && t2 > t1, t1: +t1.toFixed(2), t2: +t2.toFixed(2) };
    await p.close();
  }
  // Failover: a dead first mirror must auto-advance to the working master (source index 1).
  {
    const popup = await ctx.newPage();
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    const opened = ctx.waitForEvent('page', { timeout: 20000 });
    await popup.evaluate((master) => {
      // kind:'master' makes refineRanking early-return so the [dead, ok] order is preserved and the
      // dead mirror is actually played first (otherwise body-sniff would reorder the real one to front).
      const mk = (key, url) => ({ key, manifestUrl: url, kind: 'master', tabId: -1, frameId: 0, pageUrl: '', replayHeaders: {}, createdAt: 0 });
      return chrome.runtime.sendMessage({ type: 'OPEN_PLAYER', streams: [mk('dead', 'http://localhost:8787/open/__nope__.m3u8'), mk('ok', master)] });
    }, `${CDN}/open/master.m3u8`);
    const fo = await opened;
    let r = { ok: false, note: 'player tab not detected' };
    try {
      await fo.waitForFunction(() => (document.querySelector('video')?.currentTime ?? 0) > 0, { timeout: 45000 });
      const fi = await fo.evaluate(() => ({ ct: document.querySelector('video')?.currentTime ?? 0, src: document.getElementById('sources')?.value ?? null }));
      r = { ok: fi.ct > 0 && fi.src === '1', ...fi };
    } catch (e) {
      r = { ok: false, note: String(e?.message ?? e) };
    }
    results.playback.failover = r;
    await popup.close();
  }

  // ---- PART 3: gating ----
  // Positive control: the fixture page (origin :3100) plays the Referer-gated stream — gate + stream are real.
  {
    const p = await ctx.newPage();
    await p.goto(srv.fixtureUrl('gated-referer-play'), { waitUntil: 'load' }).catch(() => {});
    await p.waitForFunction(() => (document.querySelector('video')?.currentTime ?? 0) > 0, { timeout: 30000 }).catch(() => {});
    const ct = await p.evaluate(() => document.querySelector('video')?.currentTime ?? 0);
    results.gating.refererPositiveControl = { ok: ct > 0, ct: +ct.toFixed(2) };
    await p.close();
  }
  // Negative: the extension player can't load the gated stream without header injection → all-failed.
  {
    const p = await ctx.newPage();
    await p.goto(`chrome-extension://${extId}/player.html#src=${encodeURIComponent(`${CDN}/gated/referer/manifest.m3u8`)}`);
    let failedOverlay = false;
    try {
      await p.waitForFunction(
        () => {
          const o = document.getElementById('overlay');
          const v = document.querySelector('video');
          const msg = document.getElementById('overlayMsg')?.textContent ?? '';
          return (o && !o.hidden && /failed/i.test(msg)) || (v && v.currentTime > 0);
        },
        { timeout: 25000 },
      );
      failedOverlay = await p.evaluate(() => { const o = document.getElementById('overlay'); return !!o && !o.hidden && /failed/i.test(document.getElementById('overlayMsg')?.textContent ?? ''); });
    } catch {
      /* neither happened in time */
    }
    const ct = await p.evaluate(() => document.querySelector('video')?.currentTime ?? 0);
    results.gating.refererNegative = { ok: ct === 0 && failedOverlay, ct, failedOverlay };
    await p.close();
  }

  // ---- report ----
  console.log('\n=== DETECTION MATRIX ===');
  for (const d of results.detect) {
    const mark = d.info ? 'ℹ' : d.ok ? '✓' : '✗';
    const exp = d.info ? '(info)' : d.expect;
    console.log(`  ${mark} ${d.name.padEnd(20)} detected=${String(d.matched).padEnd(5)} expected=${exp}${d.note ? `   (${d.note})` : ''}`);
  }
  console.log('\n=== PLAYBACK ===');
  console.log(`  ${results.playback.vod?.ok ? '✓' : '✗'} VOD master      ${JSON.stringify(results.playback.vod)}`);
  console.log(`  ${results.playback.live?.ok ? '✓' : '✗'} LIVE live-ify   ${JSON.stringify(results.playback.live)}`);
  console.log(`  ${results.playback.failover?.ok ? '✓' : '✗'} failover        ${JSON.stringify(results.playback.failover)}`);
  console.log('\n=== GATING ===');
  console.log(`  ${results.gating.refererPositiveControl?.ok ? '✓' : '✗'} referer gate is real (page plays)   ${JSON.stringify(results.gating.refererPositiveControl)}`);
  console.log(`  ${results.gating.refererNegative?.ok ? '✓' : '✗'} extension blocked w/o injection     ${JSON.stringify(results.gating.refererNegative)}`);
  console.log('\n  note: on-wire header injection (the with-grant positive) is covered by the unit tests');
  console.log('        (header-injector-chrome/firefox) + the DNR rule-shape check in verify.mjs — a host-');
  console.log('        permission grant cannot be auto-accepted in headless Playwright. Use the debug build');
  console.log('        (pnpm dev) to confirm on any real site.');

  const detectOk = results.detect.filter((d) => !d.info).every((d) => d.ok);
  const playOk = results.playback.vod?.ok && results.playback.live?.ok && results.playback.failover?.ok;
  const gateOk = results.gating.refererPositiveControl?.ok && results.gating.refererNegative?.ok;
  const allOk = detectOk && playOk && gateOk;
  console.log(`\nVERIFY FIXTURES: ${allOk ? 'PASS' : 'FAIL'}`);
  process.exitCode = allOk ? 0 : 1;
} finally {
  await ctx.close();
  await srv.close();
}
