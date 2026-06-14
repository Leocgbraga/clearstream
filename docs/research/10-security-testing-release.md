# Research 10 — Security, performance, testing & release pipeline

> Verbatim research report. High quality bar: lightweight, secure, tested, automated build/sign/
> publish for Chrome, Edge, Firefox + a self-hosted signed `.xpi`.

## 0. Stack
Vite + Rollup (real tree-shaking for hls.js; via WXT). TypeScript `strict`. Single source manifest
+ per-browser overrides at build time (WXT). pnpm + committed lockfile (supply-chain anchor).

## 1. Store-compliance rules that constrain code
**No remotely-hosted code** (the rule that shapes the build). Chrome rejects external `<script>`/
import, `eval`/`new Function`/string-`setTimeout` on remote strings, remote-command interpreters.
Consequences: **bundle hls.js** (`import Hls from 'hls.js'`, never a CDN `<script>`); no dynamic
*remote* `import()`; no `eval` (enforce `no-eval`/`no-implied-eval` + CI grep); the only network is
`fetch`/MSE of media (data, not logic). The rejection code is "Blue Argon." AMO is equally strict
(default CSP disallows `eval`; remote-script CSP → rejection) and human-reviews source → ship
readable/source-mapped code or a documented reproducible build.
**MV3 CSP for extension pages:** default `script-src 'self'; object-src 'self'`; min you can narrow
to adds `'wasm-unsafe-eval'`; `'unsafe-eval'`/`'unsafe-inline'` are install-time errors. → **no
inline `<script>` or `onclick=`**; wire events in external JS.
```json
"content_security_policy":{ "extension_pages":
  "script-src 'self'; object-src 'self'; media-src 'self' blob: https:; img-src 'self' data: https:; style-src 'self'" }
```
`media-src … blob:` for hls.js MSE; `worker-src 'self' blob:` if `enableWorker`. **Firefox** honors
the same object form; needs `gecko.id` + `strict_min_version`; FF MV3 background is an event page.
**Rejection triggers:** remote/eval; over-broad host perms vs stated purpose; missing single-purpose
+ per-permission justifications; minified-only AMO source w/o reproducible-build notes; unused perms.

## 2. Bundle size / footprint
hls.js v1.6.x: full ESM ~70 KB gz; light ~50 KB gz. (Player research argues **full** for alt-audio;
local bundle → size delta irrelevant.) Import the `.mjs` for tree-shaking; `build.target:'es2022'`
(don't down-level → no polyfill bloat); `minify:'esbuild'`, `sourcemap:true` (AMO reviewability).
**Lazy-load** hls.js via dynamic local `import()` when a player opens. **Keep SW tiny** (detection
only, no hls.js/DOM; <15 KB). Realistic `.zip` ~200–300 KB. CI budget: fail if `dist/`>400 KB or hls
chunk >180 KB raw.

## 3. Security
**Input:** treat every captured URL as untrusted — `new URL(raw)` in try/catch, **allowlist
protocols** to `https:` (reject blob:/data:/file:/javascript:/chrome-extension:), never interpolate
into HTML/CSS; assign via DOM props only; cap + dedupe the stored list.
**XSS (main surface):** page titles/URLs are arbitrary → **never** innerHTML/insertAdjacentHTML/
document.write; use `textContent`/`setAttribute`/`new Option(text)`; links only after URL+protocol
check + `rel="noopener noreferrer"`. Enforced by CSP (no inline) + ESLint
`eslint-plugin-no-unsanitized`.
**Sandbox the player (defense in depth):** render the actual `<video>`/hls.js in a `"sandbox"` page
embedded via `<iframe sandbox="allow-scripts">`, captured URL passed by origin-checked `postMessage`;
the sandboxed frame has no extension-API access → MSE/hls.js exploit can't reach storage/perms.
(FF sandbox support differs → fall back to strict-CSP normal page on FF.)
**Minimal perms:** `["webRequest","storage","activeTab"]` (a detector); **no `<all_urls>`** content
scripts; no `tabs` (use activeTab); no `scripting`/`declarativeNetRequest`/`cookies` unless used;
one-line justification each.
**Supply chain:** pin hls.js exactly + committed lockfile; `pnpm audit --audit-level=high` +
`pnpm audit signatures` CI gate; `--ignore-scripts` in CI; npm trusted-publishing provenance if you
publish a package; `actions/attest-build-provenance` on the `.zip`/`.xpi`; OpenSSF Scorecard +
`step-security/harden-runner`.

## 4. Testing
**Unit (Vitest):** m3u8 master/media + variant enumeration; failover ordering/retry; dedupe/
normalization; URL/protocol allowlist (table-driven). `core/**` has zero chrome/DOM imports →
fast, headless; coverage floor ~90%.
**E2E (Playwright):** load the **built `dist/`** via persistent context.
```ts
// fixtures.ts
export const test = base.extend({
  context: async ({}, use) => { const c = await chromium.launchPersistentContext('', { channel:'chromium',
    args:[`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] }); await use(c); await c.close(); },
  extensionId: async ({context}, use) => { let [sw]=context.serviceWorkers(); if(!sw) sw=await context.waitForEvent('serviceworker');
    await use(sw.url().split('/')[2]); } });
```
```ts
// detect.spec.ts — assert detection in popup, and actual playback:
await player.goto(`chrome-extension://${id}/player.html#src=${encodeURIComponent(MUX_TEST)}`);
await player.waitForFunction(()=>{ const v=document.querySelector('video'); return v && v.readyState>=3 && v.currentTime>0; }, null, {timeout:20000});
```
Use a stable public test stream (`test-streams.mux.dev/x36xhzz/x36xhzz.m3u8`); assert on
`readyState`/`currentTime`, not pixels. SW may suspend after ~30s → wake it before asserting. FF E2E:
drive via `web-ext run` smoke + unit tests + `web-ext lint --warnings-as-errors` (Mozilla's
addons-linter = what AMO runs → green lint predicts clean submission).
**Blocking CI gates:** `tsc --noEmit` · ESLint (no-eval, no-unsanitized) · `vitest run --coverage` ·
Playwright (Chromium) · `web-ext lint` (FF) · bundle-size budget · `pnpm audit`.

## 5. CI/CD release pipeline
Actions: Chrome = `mnao305/chrome-extension-upload` (CLIENT_ID/SECRET/REFRESH_TOKEN + ext id; CWS API
v1 supported until 2026-10-15). Edge = `wdzeng/edge-addon@v2` (product-id/zip/client-id/api-key;
updates an existing add-on — first submit manual). Firefox listed = `wdzeng/firefox-addon` or
`web-ext sign`; self-host `.xpi` = `web-ext sign --channel=unlisted` (AMO JWT issuer+secret).
Alt one-shot: `PlasmoHQ/bpp` (prefer per-store actions for failure isolation + `.xpi` control).
Secrets as GitHub Environments with required reviewers on `release`.
```yaml
name: release
on: { push: { tags: ['v*'] } }
permissions: { contents: write, id-token: write, attestations: write }
jobs:
  ci: # checkout → pnpm install --frozen-lockfile --ignore-scripts → audit → typecheck → lint →
      # vitest → build (3 targets) → size gate → playwright install chromium → test:e2e →
      # web-ext lint dist/firefox --warnings-as-errors → upload-artifact dist
  release:
    needs: ci
    environment: release         # gated: manual approval
    steps:
      - download-artifact dist
      - web-ext sign --source-dir dist/firefox --channel=unlisted --api-key=$AMO_ISSUER --api-secret=$AMO_SECRET --artifacts-dir dist/xpi
      - wdzeng/firefox-addon@v1  (addon-guid, xpi-path: dist/firefox.zip, jwt-issuer, jwt-secret)
      - mnao305/chrome-extension-upload@v5 (file-path: dist/chrome.zip, extension-id, client-id, client-secret, refresh-token, publish: true)
      - wdzeng/edge-addon@v2 (product-id, zip-path: dist/edge.zip, client-id, api-key)
      - actions/attest-build-provenance@v1 (subject-path: dist/chrome.zip,dist/edge.zip,dist/xpi/*.xpi)
      - softprops/action-gh-release@v2 (files: dist/chrome.zip, dist/edge.zip, dist/xpi/*.xpi; generate_release_notes)
```
**Versioning/auto-update:** single source = git tag → injected into all 3 manifests at build
(numeric-only, ≤4 parts). Chrome/Edge/AMO auto-serve updates once approved. Self-host `.xpi` needs a
hosted `update_manifest.json` (regenerated per release) referenced by `gecko.update_url`. Use
`release-please`/Changesets on `main` for bump+changelog+tag → triggers `release.yml`. CI
(lint/test/build/E2E) on every PR; only **tags** publish; `release` env forces human approval.

## Sources
developer.chrome.com (remote-hosted-code, mv3-requirements, content-security-policy, improve-security,
webstore using-api/v1) · MDN WebExtensions CSP · extensionworkshop.com (MV3 migration, web-ext command
ref, getting-started sign/unlisted) · github.com/mozilla/addons-linter · requestly.com self-host FF ·
npmjs hls.js + github discussion #6720 + releases · playwright.dev/docs/chrome-extensions ·
github.com/{mnao305/chrome-extension-upload, fregante/chrome-webstore-upload-keys, wdzeng/edge-addon,
wdzeng/firefox-addon} · learn.microsoft.com edge addons api · docs.npmjs.com generating-provenance +
trusted-publishers · github.blog npm package provenance.
