// Store-clean gate (POWER build-channel). The multi-mirror resolver ships ONLY in the off-store power
// build (CS_POWER=1). This asserts the STORE build (.output/chrome-mv3, produced by `pnpm build`) carries
// none of it: no `tabs` permission in the manifest, and no resolver sentinel in any bundled .js. That's
// the guarantee the gate actually holds and the store listing stays the reactive detector+player.
// Run after `pnpm build`. See POWER.md.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve('.output/chrome-mv3');
const SENTINEL = 'CS_POWER_RESOLVER'; // marker string embedded in every resolver module
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
  if (readFileSync(f, 'utf8').includes(SENTINEL)) {
    console.error(`✗ resolver code leaked into the store build: ${path.relative(process.cwd(), f)}`);
    failed++;
  }
}

console.log(
  failed
    ? `\nSTORE-CLEAN: FAIL (${failed} issue(s))`
    : `STORE-CLEAN: PASS (${scanned} files, no resolver code, no tabs permission)`,
);
process.exit(failed ? 1 : 0);
