// Bundle-size budget (Phase 6). The heavy player chunk (hls.js + media-chrome) is lazy-loaded only
// when player.html opens, so it's allowed to be large. The real regression this guards: someone
// accidentally importing the player stack into background.js or the popup, which would balloon code
// that loads eagerly. Tight budgets there, generous for the lazy player chunk. Run after a build.
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve('.output/chrome-mv3');
const KB = 1024;

const BUDGETS = [
  { label: 'background.js', match: /^background\.js$/, maxKB: 40 },
  { label: 'popup chunk', match: /^chunks\/popup-.*\.js$/, maxKB: 50 },
  { label: 'player chunk (lazy)', match: /^chunks\/player-.*\.js$/, maxKB: 900 },
];
const TOTAL_MAX_KB = 850;

function walk(dir, base = dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p, base));
    else out.push({ rel: path.relative(base, p).replace(/\\/g, '/'), size: s.size });
  }
  return out;
}

let files;
try {
  files = walk(root);
} catch {
  console.error('No .output/chrome-mv3 — run `pnpm build` first.');
  process.exit(1);
}

let failed = 0;
const total = files.reduce((n, f) => n + f.size, 0);

console.log('Bundle budgets (chrome-mv3):');
for (const b of BUDGETS) {
  const size = files.filter((f) => b.match.test(f.rel)).reduce((n, f) => n + f.size, 0);
  const kb = size / KB;
  const ok = kb <= b.maxKB;
  if (!ok) failed++;
  console.log(`  ${ok ? '✓' : '✗'} ${b.label.padEnd(20)} ${kb.toFixed(1).padStart(7)} KB  (budget ${b.maxKB} KB)`);
}
const totalKB = total / KB;
const totalOk = totalKB <= TOTAL_MAX_KB;
if (!totalOk) failed++;
console.log(`  ${totalOk ? '✓' : '✗'} ${'total'.padEnd(20)} ${totalKB.toFixed(1).padStart(7)} KB  (budget ${TOTAL_MAX_KB} KB)`);

console.log(failed ? `\nBUNDLE SIZE: FAIL (${failed} over budget)` : '\nBUNDLE SIZE: PASS');
process.exit(failed ? 1 : 0);
