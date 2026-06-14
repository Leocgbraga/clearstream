import { defineConfig } from 'wxt';

// Single source of truth for the per-browser manifest.
// See docs/research/08-cross-browser.md and docs/decisions.md (D6, D7, D9).
export default defineConfig({
  srcDir: 'src',
  // @wxt-dev/auto-icons resizes one source image (src/assets/icon.png) to all manifest sizes.
  modules: ['@wxt-dev/auto-icons'],
  autoIcons: {
    // Resolved relative to srcDir ('src') → src/assets/icon.png
    baseIconPath: 'assets/icon.png',
  },
  // Force MV3 on every browser (incl. Firefox) — modern manifest + FF's retained blocking webRequest.
  manifestVersion: 3,
  manifest: ({ browser }) => {
    const isFirefox = browser === 'firefox';

    // Minimal install footprint: empty host_permissions (no scary warning).
    // Detection runs via declarativeNetRequest (no host access needed); host access for a
    // specific CDN is requested at runtime when the user clicks "Watch".
    const base = {
      name: 'ClearStream — HLS Stream Detector & Player',
      description:
        'Detects HLS (.m3u8) streams on the page and plays them in a clean, ad-free player. ' +
        'No YouTube, no DRM. You are responsible for ensuring you may access any stream detected.',
      // webRequest = optional passive detection/header-capture (inert until host access granted);
      // declarativeNetRequest = header injection (Phase 3). Neither adds a host warning at install.
      permissions: ['webRequest', 'declarativeNetRequest', 'storage', 'activeTab', 'scripting'] as string[],
      optional_host_permissions: ['*://*/*'],
      host_permissions: [] as string[],
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
