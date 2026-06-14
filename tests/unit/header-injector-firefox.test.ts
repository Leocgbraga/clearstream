import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory fake of webRequest.onBeforeSendHeaders to assert the WebRequestInjector listener
// lifecycle (L4: the blocking listener is added on first apply() and torn down once no tab needs it)
// and its host-scoped header transform (B2, Firefox side).
const { state } = vi.hoisted(() => ({
  state: { listeners: [] as Array<(d: unknown) => unknown>, addCalls: 0, removeCalls: 0 },
}));
vi.mock('wxt/browser', () => ({
  browser: {
    webRequest: {
      onBeforeSendHeaders: {
        addListener: (fn: (d: unknown) => unknown) => {
          state.listeners.push(fn);
          state.addCalls++;
        },
        removeListener: (fn: (d: unknown) => unknown) => {
          state.listeners = state.listeners.filter((l) => l !== fn);
          state.removeCalls++;
        },
      },
    },
  },
}));

import { WebRequestInjector } from '@/core/header-injector/firefox';

type BSH = (d: {
  tabId: number;
  url: string;
  requestHeaders?: Array<{ name: string; value?: string }>;
}) => { requestHeaders?: Array<{ name: string; value?: string }> };

beforeEach(() => {
  state.listeners = [];
  state.addCalls = 0;
  state.removeCalls = 0;
});

describe('WebRequestInjector lifecycle (L4)', () => {
  it('adds the blocking listener on first apply() and removes it when the last tab clears', async () => {
    const inj = new WebRequestInjector();
    await inj.apply(7, { referer: 'https://site/' }, ['cdn.example']);
    expect(state.addCalls).toBe(1);
    expect(state.listeners).toHaveLength(1);

    await inj.clear(7);
    expect(state.removeCalls).toBe(1);
    expect(state.listeners).toHaveLength(0);
  });

  it('adds the listener once (not per-tab) and keeps it while any tab needs it', async () => {
    const inj = new WebRequestInjector();
    await inj.apply(1, { referer: 'https://a/' }, ['a']);
    await inj.apply(2, { referer: 'https://b/' }, ['b']);
    expect(state.addCalls).toBe(1);

    await inj.clear(1);
    expect(state.listeners).toHaveLength(1); // tab 2 still active
    await inj.clear(2);
    expect(state.listeners).toHaveLength(0);
  });

  it('reconcile() that drops every live tab tears the listener down', async () => {
    const inj = new WebRequestInjector();
    await inj.apply(10, { referer: 'https://a/' }, ['a']);
    await inj.reconcile([]);
    expect(state.listeners).toHaveLength(0);
  });

  it('re-adds the listener on a fresh apply() after teardown', async () => {
    const inj = new WebRequestInjector();
    await inj.apply(5, { referer: 'https://a/' }, ['a']);
    await inj.clear(5);
    await inj.apply(6, { referer: 'https://b/' }, ['b']);
    expect(state.addCalls).toBe(2);
    expect(state.listeners).toHaveLength(1);
  });

  it('injects the Referer only for granted CDN hosts (no leak to other hosts)', async () => {
    const inj = new WebRequestInjector();
    await inj.apply(9, { referer: 'https://site/' }, ['cdn.example']);
    const onBSH = state.listeners[0]! as unknown as BSH;

    const granted = onBSH({ tabId: 9, url: 'https://cdn.example/seg.ts', requestHeaders: [] });
    expect(granted.requestHeaders?.find((h) => h.name === 'Referer')?.value).toBe('https://site/');

    const other = onBSH({ tabId: 9, url: 'https://tracker.evil/seg.ts', requestHeaders: [] });
    expect(other.requestHeaders).toBeUndefined();
  });
});
