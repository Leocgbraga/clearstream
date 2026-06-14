// Interactive dev browser. Launches Playwright's bundled Chromium — which still honors
// `--load-extension`, unlike Google Chrome 138+ (it blocks CLI-loaded extensions via the
// DisableLoadExtensionCommandLineSwitch feature) — with the debug build loaded, so you can drive
// ClearStream by hand on real sites. Stays open until you close the window.
//   node scripts/dev-browser.mjs        (uses .output/chrome-mv3-dev — has the 🔧 debug panel)
//   EXT=chrome-mv3 node scripts/dev-browser.mjs   (the pristine production build)
import { chromium } from 'playwright';
import path from 'node:path';
import { existsSync } from 'node:fs';

const dir = process.env.EXT || 'chrome-mv3-dev';
const ext = path.resolve('.output', dir);
if (!existsSync(ext)) {
  console.error(`No .output/${dir} — run \`pnpm build:debug\` (debug) or \`pnpm build\` (prod) first.`);
  process.exit(1);
}

const ctx = await chromium.launchPersistentContext('/tmp/clearstream-chromium', {
  headless: false,
  viewport: null,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--start-maximized'],
});

let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 }).catch(() => null);
const id = sw ? sw.url().split('/')[2] : '(service worker dormant — open the popup to wake it)';
console.log(`\nClearStream (${dir}) loaded. extension id: ${id}`);

// Land on a page that actually plays an HLS stream, so you can immediately click the icon ->
// Find streams -> Watch. Navigate anywhere else (real sites) yourself.
const first = ctx.pages()[0] ?? (await ctx.newPage());
await first
  .goto('https://hls-js.netlify.app/demo/?src=https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8')
  .catch(() => {});

console.log('Browser is open. Click the ClearStream toolbar icon -> Find streams -> Watch.');
console.log('Close the window (or Ctrl-C here) when done.\n');
ctx.on('close', () => process.exit(0));
await new Promise(() => {}); // keep the process (and the window) alive
