import { defineConfig } from 'wxt';

// Single source of truth for the per-browser manifest.
// See docs/research/08-cross-browser.md and docs/decisions.md (D6, D7, D9).
export default defineConfig({
  srcDir: 'src',
  // The off-store power build (CS_POWER=1) writes to .output/power/ so it never clobbers the store
  // build in .output/ (and check:store / verify always operate on the clean store artifact).
  outDir: process.env.CS_POWER === '1' ? '.output/power' : '.output',
  // @wxt-dev/auto-icons resizes one source image (src/assets/icon.png) to all manifest sizes.
  modules: ['@wxt-dev/auto-icons'],
  autoIcons: {
    // Resolved relative to srcDir ('src') → src/assets/icon.png
    baseIconPath: 'assets/icon.png',
  },
  // Force MV3 on every browser (incl. Firefox) — modern manifest + FF's retained blocking webRequest.
  manifestVersion: 3,
  // Build-channel flag: __POWER__ is true only for `pnpm build:power` (CS_POWER=1) — the off-store build
  // that compiles in the multi-mirror resolver. Store builds leave it false → the resolver tree-shakes out.
  vite: () => ({ define: { __POWER__: JSON.stringify(process.env.CS_POWER === '1') } }),
  manifest: ({ browser }) => {
    const isFirefox = browser === 'firefox';

    // Minimal install footprint: empty host_permissions (no scary warning).
    // Detection runs via activeTab + scripting (click-to-detect) plus optional passive webRequest
    // once host access is granted; host access for a specific CDN is requested at the "Watch" click.
    const base = {
      // Localized via _locales (public/_locales/<lang>/messages.json at the project root); default_locale below.
      name: '__MSG_extName__',
      description: '__MSG_extDescription__',
      default_locale: 'en',
      // webRequest = optional passive detection/header-capture (inert until host access granted);
      // declarativeNetRequest = header injection (Phase 3). Neither adds a host warning at install.
      // `tabs` is added ONLY for the power build (background-tab resolver); store builds never carry it.
      permissions: ['webRequest', 'declarativeNetRequest', 'storage', 'activeTab', 'scripting', ...(process.env.CS_POWER === '1' ? ['tabs'] : [])] as string[],
      optional_host_permissions: ['*://*/*'],
      host_permissions: [] as string[],
      // No custom content_security_policy: MV3's default (script-src 'self'; object-src 'self')
      // already blocks remote code + eval, and a custom CSP — even a stricter one — trips AMO's
      // "needs additional review" flag (web-ext MANIFEST_CSP). hls.js runs main-thread instead
      // (enableWorker:false in hls-controller); no-remote-code is enforced by audit-no-remote-code.mjs.
    };

    if (isFirefox) {
      return {
        ...base,
        // Firefox header-injection backend = blocking webRequest (its DNR domain conditions are buggy).
        permissions: [...base.permissions, 'webRequestBlocking'],
        browser_specific_settings: {
          gecko: {
            id: 'clearstream@daedastream.dev',
            // 140 is the floor that actually honors `data_collection_permissions` (desktop);
            // declaring a lower min would mean the key is silently ignored there (web-ext warns).
            strict_min_version: '140.0',
            // No telemetry — required by AMO for new extensions (Nov 2025+).
            data_collection_permissions: { required: ['none'] },
          },
          // Firefox for Android honors the data_collection key only from 142.
          gecko_android: {
            strict_min_version: '142.0',
          },
        },
      };
    }

    return base;
  },
});
