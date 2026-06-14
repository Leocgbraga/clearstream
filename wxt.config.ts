import { defineConfig } from 'wxt';

// Single source of truth for the per-browser manifest.
// See docs/research/08-cross-browser.md and docs/decisions.md (D6, D7, D9).
export default defineConfig({
  srcDir: 'src',
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
      permissions: ['declarativeNetRequest', 'storage', 'activeTab', 'scripting'] as string[],
      optional_host_permissions: ['*://*/*'],
      host_permissions: [] as string[],
    };

    if (isFirefox) {
      return {
        ...base,
        // Firefox header-injection backend = blocking webRequest (its DNR domain conditions are buggy).
        permissions: [...base.permissions, 'webRequest', 'webRequestBlocking'],
        browser_specific_settings: {
          gecko: {
            id: 'clearstream@daedastream.dev',
            strict_min_version: '128.0',
          },
        },
      };
    }

    return base;
  },
});
