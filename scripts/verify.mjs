// Smoke/eyeball harness: load the built chrome-mv3 extension in Chromium and check that
//  A) the player plays a real HLS stream + media-chrome controls + quality renditions (Phase 1/2),
//  B) the popup UI renders,
//  C) the detection scan (Performance API + DOM) finds an .m3u8 on a real page,
//  D) the DNR modifyHeaders session-rule shape is accepted by the browser (Phase 3 injector).
// Produces screenshots in /tmp/cs-shots. Not a unit test.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');
const ext = path.join(root, '.output/chrome-mv3');
const SHOTS = '/tmp/cs-shots';
mkdirSync(SHOTS, { recursive: true });

const MUX = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
const results = {};

// Extensions require full Chromium in headed mode (headless-shell can't load them).
const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});

try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = sw.url().split('/')[2];
  console.log('extension id:', extId);

  // A) Player plays a real stream
  const player = await ctx.newPage();
  await player.setViewportSize({ width: 1000, height: 620 });
  await player.goto(`chrome-extension://${extId}/player.html#src=${encodeURIComponent(MUX)}`);
  await player.waitForFunction(
    () => {
      const v = document.querySelector('video');
      return !!v && v.readyState >= 3 && v.currentTime > 0;
    },
    { timeout: 30000 },
  );
  const info = await player.evaluate(() => {
    const v = document.querySelector('video');
    return {
      currentTime: v.currentTime,
      w: v.videoWidth,
      h: v.videoHeight,
      hasControls: !!document.querySelector('media-controller'),
      // Phase 2: hls.levels mirrored into videoRenditions (media-tracks) → media-chrome quality menu.
      renditions: v.videoRenditions ? v.videoRenditions.length : 0,
    };
  });
  // Mux test stream is VOD (#EXT-X-ENDLIST). Playing it with forceLive=true means the pLoader
  // stripped ENDLIST and it still plays → proves the live-ify loader works without breaking playback.
  results.player = { ok: info.currentTime > 0 && info.w > 0 && info.renditions > 0, ...info };
  await player.waitForTimeout(800);
  await player.screenshot({ path: path.join(SHOTS, 'phase1-player.png') });

  // B) Popup renders
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 340, height: 280 });
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.waitForSelector('#scan', { timeout: 8000 });
  results.popup = {
    ok: true,
    scanBtn: await popup.textContent('#scan'),
    hasToggle: (await popup.$('#passive')) !== null,
  };
  await popup.screenshot({ path: path.join(SHOTS, 'phase1-popup.png') });

  // C) Detection scan finds the manifest on a real page
  const page = await ctx.newPage();
  await page.goto('https://hls-js.netlify.app/demo/?src=' + encodeURIComponent(MUX), { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(5000);
  const found = await page.evaluate(() => {
    const re = /\.(m3u8|mpd)(\?|#|$)/i;
    const out = new Set();
    for (const e of performance.getEntriesByType('resource')) if (re.test(e.name)) out.add(e.name);
    document.querySelectorAll('video,source').forEach((el) => {
      const s = el.src || el.currentSrc || el.getAttribute('src') || '';
      if (s && re.test(s)) out.add(s);
    });
    return [...out];
  });
  results.detect = { ok: found.length > 0, count: found.length, sample: found.slice(0, 2) };

  // D) Phase 3: confirm the DNR session modifyHeaders rule shape (the Chrome injector's core call)
  //    is accepted and stored by this browser. (End-to-end Referer-on-wire needs a gated CDN.)
  const dnr = await sw.evaluate(async () => {
    const id = 99999;
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [id],
      addRules: [
        {
          id,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [{ header: 'Referer', operation: 'set', value: 'https://example.test/' }],
          },
          condition: { tabIds: [1], resourceTypes: ['xmlhttprequest', 'media', 'other'] },
        },
      ],
    });
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    const r = rules.find((x) => x.id === id);
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id] });
    return {
      stored: !!r,
      header: r?.action?.requestHeaders?.[0]?.header ?? null,
      op: r?.action?.requestHeaders?.[0]?.operation ?? null,
    };
  });
  results.headerInjection = {
    ok: dnr.stored && String(dnr.header).toLowerCase() === 'referer' && dnr.op === 'set',
    ...dnr,
  };

  console.log('\n=== RESULTS ===');
  console.log(JSON.stringify(results, null, 2));
  const allOk = results.player.ok && results.popup.ok && results.detect.ok && results.headerInjection.ok;
  console.log(allOk ? '\nVERIFY: PASS' : '\nVERIFY: FAIL');
  process.exitCode = allOk ? 0 : 1;
} finally {
  await ctx.close();
}
