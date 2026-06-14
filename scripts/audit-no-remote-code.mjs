// No-remote-code audit (Phase 6 hardening). MV3's default CSP already forbids eval/remote scripts at
// runtime, but this codifies it as a build gate: the shipped bundle must contain ZERO
// remote-code-execution vectors. hls.js + media-chrome are bundled locally — nothing is fetched from
// a CDN at runtime. Scans both built targets. Run: node scripts/audit-no-remote-code.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const targets = ['.output/chrome-mv3', '.output/firefox-mv3'].map((d) => path.resolve(d));

const RULES = [
  { name: 'eval()', re: /\beval\s*\(/g, ext: ['.js'] },
  { name: 'new Function()', re: /\bnew\s+Function\s*\(/g, ext: ['.js'] },
  { name: 'remote <script src>', re: /<script[^>]+src\s*=\s*["']https?:/gi, ext: ['.html'] },
  { name: 'remote import()/importScripts()', re: /\b(?:importScripts|import)\s*\(\s*["']https?:/g, ext: ['.js'] },
];

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

let violations = 0;
let scanned = 0;
for (const root of targets) {
  let files;
  try {
    files = walk(root);
  } catch {
    continue; // target not built → skip
  }
  for (const file of files) {
    const ext = path.extname(file);
    if (ext !== '.js' && ext !== '.html') continue;
    scanned++;
    const text = readFileSync(file, 'utf8');
    for (const rule of RULES) {
      if (!rule.ext.includes(ext)) continue;
      const m = text.match(rule.re);
      if (m) {
        violations += m.length;
        console.error(`✗ ${rule.name} ×${m.length} in ${path.relative(process.cwd(), file)}`);
      }
    }
  }
}

if (!scanned) {
  console.error('No build output found — run `pnpm build && pnpm build:firefox` first.');
  process.exit(1);
}
if (violations) {
  console.error(`\nNO-REMOTE-CODE AUDIT: FAIL (${violations} vector(s) across ${scanned} files)`);
  process.exit(1);
}
console.log(`NO-REMOTE-CODE AUDIT: PASS (${scanned} files, no eval / new Function / remote script / remote import)`);
