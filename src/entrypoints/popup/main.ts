import './style.css';
import { browser } from 'wxt/browser';
import type { CapturedStream } from '@/core/types';
import type { Message, StreamsResponse } from '@/core/messages';

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
    emptyMsg.textContent = "ClearStream can't scan this page.";
    stepsEl.hidden = true;
  } else {
    emptyMsg.textContent = scanned
      ? 'No HLS stream found. Some sites only load the stream after you press play — try that, then scan again.'
      : 'No stream detected on this tab yet.';
    stepsEl.hidden = scanned;
  }
}

function render(streams: CapturedStream[]): void {
  current = streams;
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
    sub.textContent = (i === 0 ? 'Best · ' : '') + (s.kind === 'master' ? 'master playlist' : pathOf(s.manifestUrl));
    sub.title = s.manifestUrl;
    info.append(host, sub);

    const actions = document.createElement('div');
    actions.className = 'actions';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'ghost';
    copy.textContent = 'Copy';
    copy.title = 'Copy stream URL';
    copy.addEventListener('click', () => {
      void navigator.clipboard.writeText(s.manifestUrl).then(() => {
        copy.textContent = '✓';
        setTimeout(() => (copy.textContent = 'Copy'), 1200);
      });
    });
    const watch = document.createElement('button');
    watch.type = 'button';
    watch.textContent = 'Watch';
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
  scanBtn.textContent = 'Scanning…';
  void refresh(true).finally(() => {
    scanBtn.disabled = false;
    scanBtn.textContent = 'Find streams on this page';
  });
});

// permissions.request() must run inside this user gesture (not via the background SW).
passiveEl.addEventListener('change', async () => {
  if (passiveEl.checked) {
    passiveEl.checked = await browser.permissions.request(ALL_SITES);
  } else {
    await browser.permissions.remove(ALL_SITES);
    passiveEl.checked = false;
  }
});

void (async () => {
  passiveEl.checked = await browser.permissions.contains(ALL_SITES);
  await refresh(false);
})();
