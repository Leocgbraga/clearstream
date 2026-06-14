import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory fake of browser.storage.session whose get/set yield to the microtask queue, exposing
// the read-modify-write race that the per-tab write queue must serialize away.
const { store } = vi.hoisted(() => ({ store: new Map<string, unknown>() }));
vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      session: {
        get: async (k: string) => {
          await Promise.resolve();
          return { [k]: store.get(k) };
        },
        set: async (obj: Record<string, unknown>) => {
          await Promise.resolve();
          for (const [k, v] of Object.entries(obj)) store.set(k, v);
        },
        remove: async (k: string) => {
          store.delete(k);
        },
      },
    },
  },
}));

import { addStreams, getStreams } from '@/core/storage';
import type { CapturedStream } from '@/core/types';

const mk = (url: string): CapturedStream => ({
  key: url,
  manifestUrl: url,
  tabId: 1,
  frameId: 0,
  pageUrl: '',
  replayHeaders: {},
  createdAt: 0,
});

beforeEach(() => store.clear());

describe('addStreams concurrency', () => {
  it('serializes concurrent writes to the same tab so no detection is lost', async () => {
    await Promise.all([addStreams(1, [mk('https://x/a.m3u8')]), addStreams(1, [mk('https://x/b.m3u8')])]);
    const urls = (await getStreams(1)).map((s) => s.manifestUrl).sort();
    expect(urls).toEqual(['https://x/a.m3u8', 'https://x/b.m3u8']);
  });
  it('keeps writes isolated per tab', async () => {
    await Promise.all([addStreams(1, [mk('https://x/a.m3u8')]), addStreams(2, [mk('https://x/b.m3u8')])]);
    expect((await getStreams(1)).map((s) => s.manifestUrl)).toEqual(['https://x/a.m3u8']);
    expect((await getStreams(2)).map((s) => s.manifestUrl)).toEqual(['https://x/b.m3u8']);
  });
});
