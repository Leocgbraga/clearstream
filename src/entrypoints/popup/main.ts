import './style.css';
import { browser } from 'wxt/browser';
import type { CapturedStream } from '@/core/types';
import type { Message, ResolveProgress, StreamsResponse } from '@/core/messages';
import { t } from '@/core/i18n';
import { DEBUG, dlog } from '@/core/debug';
import { POWER } from '@/core/power';

const listEl = document.getElementById('list') as HTMLUListElement;
const emptyEl = document.getElementById('empty') as HTMLDivElement;
const emptyMsg = document.getElementById('emptyMsg') as HTMLParagraphElement;
const stepsEl = document.getElementById('steps') as HTMLOListElement;
const scanBtn = document.getElementById('scan') as HTMLButtonElement;
const passiveEl = document.getElementById('passive') as HTMLInputElement;

const ALL_SITES = { origins: ['*://*/*'] };
// Pages where content scripts / scanning can't run.
const RESTRICTED = /^(chrome|edge|about|moz-extension|chrome-extension|view-source|https?:\/\/chrome\.google\.com\/webstore)/i;

function send<T>(msg: Message): Promise<T> {
  return browser.runtime.sendMessage(msg) as Promise<T>;
}
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return '';
  }
}

/** Unique `*://host/*` patterns across all mirrors, so one permission prompt covers failover. */
function uniqueOrigins(streams: CapturedStream[]): string[] {
  const set = new Set<string>();
  for (const s of streams) {
    try {
      const u = new URL(s.manifestUrl);
      set.add(`${u.protocol}//${u.host}/*`);
    } catch {
      /* not a URL */
    }
  }
  return [...set];
}

let current: CapturedStream[] = [];
let currentTabId: number | undefined;
let scanned = false;
let restricted = false;

function renderEmpty(): void {
  listEl.hidden = true;
  emptyEl.hidden = false;
  if (restricted) {
    emptyMsg.textContent = t('restricted');
    stepsEl.hidden = true;
  } else {
    emptyMsg.textContent = scanned ? t('emptyScanned') : t('emptyInitial');
    stepsEl.hidden = scanned;
  }
}

/** Debug-build inspector: what was detected, from which capture layer, and whether the passive +
 *  deep-capture layers are armed (all-sites grant). Created lazily; absent from production builds. */
async function renderDebug(streams: CapturedStream[]): Promise<void> {
  if (!DEBUG) return;
  let panel = document.getElementById('debug');
  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'debug';
    panel.style.cssText =
      'margin-top:8px;padding:8px 12px;border-top:1px dashed #999;font:11px/1.5 ui-monospace,monospace;white-space:pre-wrap;word-break:break-all;opacity:.8';
    (document.getElementById('app') ?? document.body).append(panel);
  }
  const allSites = await browser.permissions.contains(ALL_SITES).catch(() => false);
  const lines = [
    '🔧 debug build',
    `all-sites (passive + deep-capture): ${allSites ? 'granted' : 'off'}`,
    `detected on this tab: ${streams.length}`,
    ...streams.map((s) => `  [${s.source ?? '?'}|${s.kind ?? '?'}] ${hostOf(s.manifestUrl)}${pathOf(s.manifestUrl)}`),
  ];
  if (!streams.length) lines.push('  (DOM scan runs on "Find streams"; passive + deep-capture need all-sites)');
  panel.textContent = lines.join('\n');
}

function render(streams: CapturedStream[]): void {
  current = streams;
  void renderDebug(streams);
  listEl.replaceChildren();
  if (!streams.length) {
    renderEmpty();
    return;
  }
  emptyEl.hidden = true;
  listEl.hidden = false;

  streams.forEach((s, i) => {
    const li = document.createElement('li');
    if (i === 0) li.className = 'best';

    const info = document.createElement('div');
    info.className = 'info';
    const host = document.createElement('span');
    host.className = 'host';
    host.textContent = hostOf(s.manifestUrl);
    host.title = s.manifestUrl; // textContent/title only — never innerHTML (XSS-safe)
    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = (i === 0 ? t('best') + ' · ' : '') + (s.kind === 'master' ? t('masterPlaylist') : pathOf(s.manifestUrl));
    sub.title = s.manifestUrl;
    info.append(host, sub);

    const actions = document.createElement('div');
    actions.className = 'actions';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'ghost';
    copy.textContent = t('copy');
    copy.title = t('copyUrl');
    copy.addEventListener('click', () => {
      void navigator.clipboard.writeText(s.manifestUrl).then(() => {
        copy.textContent = '✓';
        setTimeout(() => (copy.textContent = t('copy')), 1200);
      });
    });
    const watch = document.createElement('button');
    watch.type = 'button';
    watch.textContent = t('watch');
    watch.addEventListener('click', () => {
      // Play this mirror first, the rest as failover fallbacks. Request host access for ALL their
      // CDNs in one gesture (no-op if already granted) so failover + header injection can act on each.
      const ordered = [s, ...current.filter((x) => x.key !== s.key)];
      const open = (): void => {
        void send({ type: 'OPEN_PLAYER', streams: ordered });
        window.close();
      };
      const origins = uniqueOrigins(ordered);
      if (origins.length) void browser.permissions.request({ origins }).then(open, open);
      else open();
    });

    actions.append(copy, watch);
    li.append(info, actions);
    listEl.append(li);
  });
}

async function refresh(detect: boolean): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab?.id;
  restricted = !!tab?.url && RESTRICTED.test(tab.url);
  if (currentTabId == null || restricted) {
    render([]);
    return;
  }
  const res = await send<StreamsResponse>({ type: detect ? 'DETECT' : 'GET_STREAMS', tabId: currentTabId });
  dlog('popup', detect ? 'scan' : 'get', '→', res.streams?.length ?? 0, 'stream(s) on tab', currentTabId);
  if (detect) scanned = true;
  render(res.streams ?? []);
}

// Live-update while the popup is open: passive captures write the active tab's session-storage key.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session' || currentTabId == null) return;
  const change = changes[`streams:${currentTabId}`];
  if (change) render((change.newValue as CapturedStream[] | undefined) ?? []);
});

scanBtn.addEventListener('click', () => {
  scanBtn.disabled = true;
  scanBtn.textContent = t('scanning');
  void refresh(true).finally(() => {
    scanBtn.disabled = false;
    scanBtn.textContent = t('scan');
  });
});

// POWER build only (off-store): "Resolve streams" — harvest this page's mirror/embed links, render each
// in a hidden ad-suppressed tab, and surface the .m3u8s they load (with live N/total progress), then
// reuse the normal ranked-list render + Watch (failover player). This UI never ships to the stores:
// POWER is false there, so the whole block is inert + tree-shaken. The power build is GitHub/dev-
// distributed and English-only, so these strings are intentionally not run through i18n.
if (POWER) {
  const RESOLVE_LABEL = '✨ Resolve streams';
  const resolveBtn = document.createElement('button');
  resolveBtn.type = 'button';
  resolveBtn.textContent = RESOLVE_LABEL;
  resolveBtn.title = 'Follow this page’s mirror links + embeds in hidden tabs and collect their streams';
  resolveBtn.style.cssText = 'width:100%;margin-top:8px';
  scanBtn.insertAdjacentElement('afterend', resolveBtn);

  const status = document.createElement('p');
  status.hidden = true;
  status.style.cssText = 'margin:8px 0 0;font-size:11px;color:var(--muted);text-align:center';
  resolveBtn.insertAdjacentElement('afterend', status);

  let resolving = false;

  // Live progress: the background writes resolve:<tabId> to storage.session as mirrors resolve.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session' || !resolving || currentTabId == null) return;
    const p = changes[`resolve:${currentTabId}`]?.newValue as ResolveProgress | undefined;
    if (!p) return;
    status.textContent =
      p.phase === 'harvest'
        ? 'Scanning page for mirrors…'
        : p.phase === 'done'
          ? `Resolved ${p.found} stream${p.found === 1 ? '' : 's'}.`
          : `Resolving mirrors ${p.done}/${p.total}… (${p.found} found)`;
  });

  resolveBtn.addEventListener('click', () => {
    if (currentTabId == null || restricted) {
      status.hidden = false;
      status.textContent = restricted ? 'Can’t resolve this kind of page.' : 'No active tab.';
      return;
    }
    const tabId = currentTabId;
    resolving = true;
    resolveBtn.disabled = true;
    resolveBtn.textContent = 'Resolving…';
    status.hidden = false;
    status.textContent = 'Scanning page for mirrors…';
    void send<StreamsResponse>({ type: 'RESOLVE_PAGE', tabId })
      .then((res) => {
        const streams = res.streams ?? [];
        dlog('popup: resolved', streams.length, 'stream(s) on tab', tabId);
        if (streams.length) {
          render(streams);
          status.hidden = true;
        } else {
          status.textContent = 'No streams found in this page’s mirrors.';
        }
      })
      .catch((err) => {
        status.textContent = 'Resolve failed — see console.';
        dlog('popup: resolve error', String(err));
      })
      .finally(() => {
        resolving = false;
        void browser.storage.session.remove(`resolve:${tabId}`);
        resolveBtn.disabled = false;
        resolveBtn.textContent = RESOLVE_LABEL;
      });
  });
}

// permissions.request() must run inside this user gesture (not via the background SW).
passiveEl.addEventListener('change', async () => {
  if (passiveEl.checked) {
    passiveEl.checked = await browser.permissions.request(ALL_SITES);
  } else {
    await browser.permissions.remove(ALL_SITES);
    passiveEl.checked = false;
  }
});

function applyI18n(): void {
  scanBtn.textContent = t('scan');
  (document.getElementById('trust') as HTMLElement).textContent = t('trust');
  stepsEl.querySelectorAll('li').forEach((li, i) => {
    const label = [t('step1'), t('step2'), t('step3')][i];
    if (label) li.textContent = label;
  });
  const span = document.querySelector('#passiveRow span');
  if (span) {
    span.textContent = t('autoDetect') + ' ';
    const em = document.createElement('em');
    em.textContent = t('autoDetectHint');
    span.append(em);
  }
}

void (async () => {
  applyI18n();
  passiveEl.checked = await browser.permissions.contains(ALL_SITES);
  await refresh(false);
})();
