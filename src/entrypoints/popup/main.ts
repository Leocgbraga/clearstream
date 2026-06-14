import './style.css';
import { browser } from 'wxt/browser';
import type { CapturedStream } from '@/core/types';
import type { Message, StreamsResponse } from '@/core/messages';

const listEl = document.getElementById('list') as HTMLUListElement;
const emptyEl = document.getElementById('empty') as HTMLParagraphElement;
const scanBtn = document.getElementById('scan') as HTMLButtonElement;
const passiveEl = document.getElementById('passive') as HTMLInputElement;

const ALL_SITES = { origins: ['*://*/*'] };

function send<T>(msg: Message): Promise<T> {
  return browser.runtime.sendMessage(msg) as Promise<T>;
}

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
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

function render(streams: CapturedStream[]): void {
  current = streams;
  listEl.replaceChildren();
  if (!streams.length) {
    listEl.hidden = true;
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  listEl.hidden = false;
  streams.forEach((s, i) => {
    const li = document.createElement('li');

    const label = document.createElement('span');
    label.className = 'url';
    label.textContent = (i === 0 ? '★ ' : '') + hostOf(s.manifestUrl);
    label.title = s.manifestUrl; // textContent/title only — never innerHTML (XSS-safe)

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Watch';
    btn.addEventListener('click', () => {
      // Play this mirror first, the rest as failover fallbacks. Request host access for ALL their
      // CDNs in one gesture (no-op if the passive toggle already granted) so failover can switch
      // hosts and Phase 3 header injection can act on each.
      const ordered = [s, ...current.filter((x) => x.key !== s.key)];
      const open = (): void => {
        void send({ type: 'OPEN_PLAYER', streams: ordered });
        window.close();
      };
      const origins = uniqueOrigins(ordered);
      if (origins.length) void browser.permissions.request({ origins }).then(open, open);
      else open();
    });

    li.append(label, btn);
    listEl.append(li);
  });
}

async function refresh(detect: boolean): Promise<void> {
  const tabId = await activeTabId();
  if (tabId == null) return;
  const res = await send<StreamsResponse>({
    type: detect ? 'DETECT' : 'GET_STREAMS',
    tabId,
  });
  render(res.streams ?? []);
}

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
