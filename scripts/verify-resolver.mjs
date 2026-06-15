// Resolver harness (POWER build). Proves the multi-mirror resolver works end-to-end against local
// fixtures: it opens an embed page in a hidden background tab, the real deep-capture observes the .m3u8
// it loads, and the resolved stream comes back — no external/pirate sites. Loads .output/power/chrome-mv3
// (the off-store build, which grants <all_urls> at install so deep-capture is active without a prompt).
// Run: pnpm verify:resolver  (builds the power target first).
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { startFixtureServer } from '../tests/fixtures/server.mjs';

// Defaults to the prod power build; CS_EXT_DIR lets it verify any built artifact (e.g. the power+debug
// build at .output/power/chrome-mv3-dev) without editing this file.
const ext = path.resolve(process.env.CS_EXT_DIR ?? '.output/power/chrome-mv3');
if (!existsSync(ext)) {
  console.error(`No ${ext} — run \`pnpm build:power\` (or set CS_EXT_DIR) first.`);
  process.exit(1);
}

const srv = startFixtureServer();
const results = {};
const ctx = await chromium.launchPersistentContext('', {
  headless: false,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});

try {
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = sw.url().split('/')[2];
  console.log('power extension id:', extId);

  // The power build grants <all_urls> at install → the SW registers the deep-capture content scripts on
  // startup. Give it a beat to finish before resolving.
  await new Promise((r) => setTimeout(r, 2000));

  // Drive RESOLVE_PAGE from a trusted extension page (passes the sender gate). Resolve a single embed
  // fixture that loads the CDN master playlist via fetch (no DOM trace) — the resolver must open it in a
  // background tab and return the .m3u8 the deep-capture saw.
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  const embed = `${srv.urls.PAGES}/fixtures/fetch-only`;
  const before = ctx.pages().length;
  const res = await popup.evaluate(
    (url) => chrome.runtime.sendMessage({ type: 'RESOLVE_PAGE', tabId: -1, urls: [url] }),
    embed,
  );
  const after = ctx.pages().length;
  const streams = res?.streams ?? [];
  results.single = {
    ok: streams.some((s) => /\.m3u8(\?|#|$)/i.test(s.manifestUrl ?? '')),
    count: streams.length,
    sample: streams[0]?.manifestUrl,
  };
  // The resolver opened + closed its own background tab; the page count should be back to baseline.
  results.tabCleanup = { ok: after <= before, before, after };

  // Harvest path: open an aggregator "links" page and resolve it WITHOUT explicit urls. The resolver must
  // scan the page DOM (all frames), rank the mirror links (dropping social/nav noise), open each in a
  // hidden tab, capture every .m3u8, master-probe + rank — and the master mirror must win. Meanwhile the
  // popunder mirror's window.open is suppressed, so no orphan ad tab leaks.
  const linksUrl = `${srv.urls.PAGES}/fixtures/links`;
  const linksPage = await ctx.newPage();
  await linksPage.goto(linksUrl);
  const linksTabId = await sw.evaluate(
    (u) => chrome.tabs.query({}).then((tabs) => tabs.find((t) => t.url === u)?.id ?? -1),
    linksUrl,
  );
  const hBefore = ctx.pages().length;
  const hRes = await popup.evaluate((tabId) => chrome.runtime.sendMessage({ type: 'RESOLVE_PAGE', tabId }), linksTabId);
  const hAfter = ctx.pages().length;
  const hStreams = hRes?.streams ?? [];
  const top = hStreams[0]?.manifestUrl ?? '';
  results.harvest = {
    ok: hStreams.length > 0 && /\.m3u8(\?|#|$)/i.test(top),
    masterWon: hStreams[0]?.kind === 'master' || /master\.m3u8/i.test(top),
    count: hStreams.length,
    top,
  };
  // All resolver-opened tabs closed AND the popunder suppressed → page count back to the pre-resolve
  // baseline. A leaked ad tab (suppression failure) would push hAfter above hBefore.
  results.harvestCleanup = { ok: hAfter <= hBefore, before: hBefore, after: hAfter };

  // --- Schedule lister: two structurally-different layouts must parse to the same EventItem shape,
  // proving the parser is domain-agnostic (matchup from link text vs. from slug/sibling). ---
  const listEvents = async (fixture) => {
    const url = `${srv.urls.PAGES}/fixtures/${fixture}`;
    const page = await ctx.newPage();
    await page.goto(url);
    const tabId = await sw.evaluate((u) => chrome.tabs.query({}).then((t) => t.find((x) => x.url === u)?.id ?? -1), url);
    const res = await popup.evaluate((id) => chrome.runtime.sendMessage({ type: 'LIST_EVENTS', tabId: id }), tabId);
    await page.close();
    return res?.events ?? [];
  };
  const cards = await listEvents('schedule-cards');
  const rows = await listEvents('schedule-rows');
  results.eventsCards = {
    ok:
      cards.length === 3 &&
      cards[0]?.status === 'live' &&
      /Red Sox vs Texas Rangers/i.test(cards[0]?.title ?? '') &&
      cards[2]?.status === 'finished' &&
      !cards.some((e) => /facebook/i.test(e.url) || /\/nba$/i.test(e.url)),
    titles: cards.map((e) => `${e.status}:${e.title}`),
  };
  results.eventsRows = {
    ok:
      rows.length === 2 &&
      rows.some((e) => e.title === 'Lakers vs Celtics' && e.status === 'live') &&
      rows.some((e) => e.title === 'Bruins vs Rangers') &&
      !rows.some((e) => /\/nba$/i.test(e.url) || /t\.me/i.test(e.url)),
    titles: rows.map((e) => `${e.status}:${e.title}`),
  };

  // --- Watch a game: RESOLVE_EVENT opens the event page in a hidden tab, harvests ITS mirrors, resolves
  // them, returns the playable stream (2-level: schedule → event page → mirrors → stream), tabs cleaned. ---
  const eventUrl = `${srv.urls.PAGES}/fixtures/event-1`;
  const evBefore = ctx.pages().length;
  const evRes = await popup.evaluate((url) => chrome.runtime.sendMessage({ type: 'RESOLVE_EVENT', url, tabId: -1 }), eventUrl);
  const evAfter = ctx.pages().length;
  const evStreams = evRes?.streams ?? [];
  results.watchEvent = {
    ok: evStreams.some((s) => /master\.m3u8/i.test(s.manifestUrl ?? '')) && evAfter <= evBefore,
    count: evStreams.length,
    top: evStreams[0]?.manifestUrl,
    cleanup: { before: evBefore, after: evAfter },
  };

  // Popup UI (power build): the "✨ Resolve streams" button must be present + wired. The full
  // button→active-tab→render happy path isn't auto-driven here — Playwright can't bind a real
  // browser-action popup to an underlying active tab — so resolution itself is proven by the direct
  // RESOLVE_PAGE tests above; here we prove the button renders and its handler runs (surfaces status).
  const btn = popup.locator('button', { hasText: 'Resolve streams' });
  const btnPresent = (await btn.count()) === 1;
  let statusShown = false;
  if (btnPresent) {
    await btn.click();
    statusShown = await popup
      .locator('p')
      .filter({ hasText: /resolv|mirror|tab/i })
      .first()
      .isVisible()
      .catch(() => false);
  }
  results.popupUi = { ok: btnPresent && statusShown, btnPresent, statusShown };

  console.log('\n=== RESOLVER ===');
  console.log(`  ${results.single.ok ? '✓' : '✗'} resolve embed → m3u8        ${JSON.stringify(results.single)}`);
  console.log(`  ${results.tabCleanup.ok ? '✓' : '✗'} resolver tab cleaned up     ${JSON.stringify(results.tabCleanup)}`);
  console.log(`  ${results.harvest.ok ? '✓' : '✗'} harvest links → m3u8        ${JSON.stringify(results.harvest)}`);
  console.log(`  ${results.harvest.masterWon ? '✓' : '✗'} master mirror ranked first  ${JSON.stringify({ top: results.harvest.top })}`);
  console.log(`  ${results.harvestCleanup.ok ? '✓' : '✗'} popunder suppressed/cleaned ${JSON.stringify(results.harvestCleanup)}`);
  console.log(`  ${results.popupUi.ok ? '✓' : '✗'} power popup resolve button  ${JSON.stringify(results.popupUi)}`);
  console.log(`  ${results.eventsCards.ok ? '✓' : '✗'} schedule (cards layout)     ${JSON.stringify(results.eventsCards)}`);
  console.log(`  ${results.eventsRows.ok ? '✓' : '✗'} schedule (rows layout)      ${JSON.stringify(results.eventsRows)}`);
  console.log(`  ${results.watchEvent.ok ? '✓' : '✗'} watch game (2-level resolve) ${JSON.stringify(results.watchEvent)}`);

  const allOk =
    results.single.ok &&
    results.tabCleanup.ok &&
    results.harvest.ok &&
    results.harvest.masterWon &&
    results.harvestCleanup.ok &&
    results.popupUi.ok &&
    results.eventsCards.ok &&
    results.eventsRows.ok &&
    results.watchEvent.ok;
  console.log(`\nVERIFY RESOLVER: ${allOk ? 'PASS' : 'FAIL'}`);
  process.exitCode = allOk ? 0 : 1;
} finally {
  await ctx.close();
  await srv.close();
}
