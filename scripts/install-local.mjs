// Build ClearStream and copy it to a STABLE folder outside .output/ so a later `wxt build`
// (which wipes .output/) never pulls the rug out from under a load-unpacked extension.
//
//   node scripts/install-local.mjs            # power/resolver build, Chrome  (default)
//   node scripts/install-local.mjs --store    # plain detector+player, Chrome
//   node scripts/install-local.mjs --firefox  # Firefox build (add --store/--power too)
//   node scripts/install-local.mjs --power --firefox
//
// Stable home: ~/.clearstream/<channel>-<browser>. Reads the manifest version for the banner.
// Zero deps (Node 18+: fs.cpSync, fs.rmSync). Run via `pnpm install:power` etc.
import { cpSync, rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { homedir, platform } from 'node:os';
import path from 'node:path';

const args = new Set(process.argv.slice(2));
const isFirefox = args.has('--firefox') || args.has('-f');
const isStore = args.has('--store'); // default is the power build
const channel = isStore ? 'store' : 'power';
const browser = isFirefox ? 'firefox' : 'chrome';

const root = path.resolve('.');
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;

// (channel, browser) → [build command + args, source dir relative to repo root]
const BUILDS = {
  'store-chrome': [['wxt', ['build']], '.output/chrome-mv3'],
  'store-firefox': [['wxt', ['build', '-b', 'firefox']], '.output/firefox-mv3'],
  'power-chrome': [['wxt', ['build'], { CS_POWER: '1' }], '.output/power/chrome-mv3'],
  'power-firefox': [['wxt', ['build', '-b', 'firefox'], { CS_POWER: '1' }], '.output/power/firefox-mv3'],
};
const key = `${channel}-${browser}`;
const [[bin, buildArgs, extraEnv = {}], srcRel] = BUILDS[key];

const label = `${channel === 'power' ? 'power/resolver' : 'detector+player'} build for ${browser}`;
console.log(`\n▶ ClearStream ${version} — building the ${label}…\n`);

// Run the WXT build through pnpm exec so the local toolchain is used.
const build = spawnSync('pnpm', ['exec', bin, ...buildArgs], {
  stdio: 'inherit',
  env: { ...process.env, ...extraEnv },
});
if (build.status !== 0) {
  console.error(`\n✗ build failed (${key}). Fix the error above and re-run.`);
  process.exit(build.status ?? 1);
}

const src = path.join(root, srcRel);
if (!existsSync(src)) {
  console.error(`\n✗ expected build output at ${src} but it isn't there.`);
  process.exit(1);
}

// Stable destination — survives `wxt build` wiping .output/.
const dest = path.join(homedir(), '.clearstream', key);
rmSync(dest, { recursive: true, force: true });
mkdirSync(path.dirname(dest), { recursive: true });
cpSync(src, dest, { recursive: true });

const extPage = isFirefox ? 'about:debugging#/runtime/this-firefox' : 'chrome://extensions';
console.log(`\n✓ Installed to a stable folder (safe across rebuilds):\n    ${dest}\n`);

if (isFirefox) {
  console.log('Load it in Firefox:');
  console.log(`  1. Open  about:debugging#/runtime/this-firefox`);
  console.log(`  2. "Load Temporary Add-on…" → pick ANY file inside:\n       ${dest}`);
  console.log('  (Temporary add-ons clear on Firefox restart — for a persistent install use a signed .xpi.)');
} else {
  console.log('Load it in Chrome / Edge / Brave:');
  console.log(`  1. Open  chrome://extensions`);
  console.log('  2. Turn on "Developer mode" (top-right)');
  console.log(`  3. "Load unpacked" → select:\n       ${dest}`);
  console.log('  It persists across restarts as long as you keep this folder. Re-run this script to update.');
}

// Best-effort: open the extensions page so the next step is one paste away.
try {
  if (platform() === 'darwin') {
    const app = isFirefox ? 'Firefox' : 'Google Chrome';
    execFileSync('open', ['-a', app, extPage], { stdio: 'ignore' });
  } else if (platform() === 'linux') {
    execFileSync('xdg-open', [extPage], { stdio: 'ignore' });
  }
} catch {
  /* opening the page is a convenience, not a requirement */
}
console.log('');
