// Store-clean gate (POWER build-channel). The multi-mirror resolver ships ONLY in the off-store power
// build (CS_POWER=1). This asserts the STORE build (.output/chrome-mv3, produced by `pnpm build`) carries
// none of it: no `tabs` permission in the manifest, and no resolver sentinel in any bundled .js. That's
// the guarantee the gate actually holds and the store listing stays the reactive detector+player.
// Run after `pnpm build`. See POWER.md.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve('.output/chrome-mv3');
const SENTINEL = 'CS_POWER_RESOLVER'; // comment marker in every resolver core module (dropped with it)
// User-facing POWER-only strings. Unlike the comment sentinel (stripped by minification), these are
// string literals that SURVIVE minification — so they catch a popup "Resolve" block that failed to
// tree-shake even if the resolver core modules were correctly dropped. Keep in sync with popup/main.ts.
const POWER_UI_MARKERS = ['Resolve streams', 'Resolving mirrors', 'Live & upcoming', 'Resolve this game', 'Find all games', 'Scanning site'];
let failed = 0;

try {
  const mf = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  if (Array.isArray(mf.permissions) && mf.permissions.includes('tabs')) {
    console.error('✗ store manifest carries the power-only "tabs" permission');
    failed++;
  }
  if (Array.isArray(mf.host_permissions) && mf.host_permissions.length) {
    console.error(`✗ store manifest declares host_permissions [${mf.host_permissions.join(', ')}] (must be empty)`);
    failed++;
  }
} catch {
  console.error('No .output/chrome-mv3/manifest.json — run `pnpm build` first.');
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}

let scanned = 0;
for (const f of walk(root)) {
  scanned++;
  const src = readFileSync(f, 'utf8');
  const rel = path.relative(process.cwd(), f);
  if (src.includes(SENTINEL)) {
    console.error(`✗ resolver code leaked into the store build: ${rel}`);
    failed++;
  }
  for (const marker of POWER_UI_MARKERS) {
    if (src.includes(marker)) {
      console.error(`✗ POWER-only UI string "${marker}" leaked into the store build: ${rel}`);
      failed++;
    }
  }
}

console.log(
  failed
    ? `\nSTORE-CLEAN: FAIL (${failed} issue(s))`
    : `STORE-CLEAN: PASS (${scanned} files, no resolver code, no tabs permission)`,
);
process.exit(failed ? 1 : 0);
