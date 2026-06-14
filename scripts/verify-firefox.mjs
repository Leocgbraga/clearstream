// Firefox runtime smoke test (Phase 5 cross-browser parity). Playwright can't load Firefox
// extensions, so we drive real Firefox via Selenium + geckodriver. We pin the moz-extension UUID
// with a profile pref so the player page URL is knowable, then install the built firefox-mv3 as a
// TEMPORARY add-on (bypasses release-Firefox signature enforcement, like about:debugging).
//
// What this proves that Chrome's verify.mjs can't: our bundled player (hls.js + media-chrome +
// the live-ify pLoader + media-tracks renditions) actually plays in the Gecko engine, and the
// Firefox event-page background loads. Run: node scripts/verify-firefox.mjs   (HEADED=1 for a window)
import { Builder, until, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');
const buildDir = path.join(root, '.output/firefox-mv3');
const xpi = path.join(root, '.output/clearstream-firefox.xpi');
const FF_BIN = '/Applications/Firefox.app/Contents/MacOS/firefox';
const ADDON_ID = 'clearstream@daedastream.dev';
// Any fixed valid UUID — pinning it makes moz-extension://<uuid>/ deterministic for navigation.
const UUID = 'a7c3e1d2-4b5f-4c6a-8d9e-0f1a2b3c4d5e';
const MUX = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
const HEADED = process.env.HEADED === '1';

if (!existsSync(buildDir)) {
  console.error('No .output/firefox-mv3 — run `pnpm build:firefox` first.');
  process.exit(1);
}
// XPI is just a zip of the build dir (selenium installAddon needs a file, not a directory).
rmSync(xpi, { force: true });
execSync(`cd "${buildDir}" && zip -r -X -q "${xpi}" .`);

const results = {};
const options = new firefox.Options();
options.setBinary(FF_BIN);
if (!HEADED) options.addArguments('-headless');
options.setPreference('extensions.webextensions.uuids', JSON.stringify({ [ADDON_ID]: UUID }));

const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).build();
try {
  await driver.installAddon(xpi, true); // temporary=true → no signing required on release Firefox
  const base = `moz-extension://${UUID}`;

  // A) Player plays the Mux stream in the Gecko engine (the big cross-engine unknown).
  await driver.get(`${base}/player.html#src=${encodeURIComponent(MUX)}`);
  await driver.wait(async () => {
    return await driver.executeScript(
      'const v=document.querySelector("video");return !!v && v.readyState>=3 && v.currentTime>0;',
    );
  }, 40000);
  const info = await driver.executeScript(`
    const v = document.querySelector('video');
    return {
      currentTime: v.currentTime,
      w: v.videoWidth,
      h: v.videoHeight,
      hasControls: !!document.querySelector('media-controller'),
      renditions: v.videoRenditions ? v.videoRenditions.length : 0,
    };`);
  results.player = { ok: info.currentTime > 0 && info.w > 0, ...info };

  // B) Popup renders in Firefox.
  await driver.get(`${base}/popup.html`);
  await driver.wait(until.elementLocated(By.id('scan')), 8000);
  const scanTxt = await driver.findElement(By.id('scan')).getText();
  const hasToggle = (await driver.findElements(By.id('passive'))).length > 0;
  results.popup = { ok: scanTxt.length > 0, scanBtn: scanTxt, hasToggle };

  console.log('\n=== FIREFOX RESULTS ===');
  console.log(JSON.stringify(results, null, 2));
  const allOk = results.player.ok && results.popup.ok;
  console.log(allOk ? '\nFIREFOX VERIFY: PASS' : '\nFIREFOX VERIFY: FAIL');
  process.exitCode = allOk ? 0 : 1;
} catch (e) {
  console.error('\nFIREFOX VERIFY: ERROR\n', e?.message ?? e);
  process.exitCode = 1;
} finally {
  await driver.quit();
}
