// ClearStream background — service worker (Chrome/Edge) | event page (Firefox).
// Phase 0: stub that confirms the entrypoint loads. Phase 1 adds the capture engine:
// declarativeNetRequest detection + per-tab badge + webRequest header capture, with all
// listeners registered synchronously at top level (SW is ephemeral).
// See docs/research/06-capture-engine.md and docs/architecture.md (§5.2).
export default defineBackground(() => {
  console.log('[ClearStream] background ready');
});
