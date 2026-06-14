import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory fake of declarativeNetRequest session rules, to assert the DnrInjector rule shape +
// host-scoping (Phase B2) + reconcile (B3) without a real browser.
const { state } = vi.hoisted(() => ({ state: { rules: [] as Array<{ id: number; action?: unknown; condition?: unknown }> } }));
vi.mock('wxt/browser', () => ({
  browser: {
    declarativeNetRequest: {
      updateSessionRules: async (u: { removeRuleIds?: number[]; addRules?: Array<{ id: number }> }) => {
        if (u.removeRuleIds) state.rules = state.rules.filter((r) => !u.removeRuleIds!.includes(r.id));
        if (u.addRules) state.rules.push(...(u.addRules as typeof state.rules));
      },
      getSessionRules: async () => state.rules,
    },
  },
}));

import { DnrInjector } from '@/core/header-injector/chrome';

beforeEach(() => {
  state.rules = [];
});

describe('DnrInjector', () => {
  it('installs a tab+host-scoped modifyHeaders rule for the chosen headers', async () => {
    const inj = new DnrInjector();
    await inj.apply(7, { referer: 'https://site/' }, ['cdn.example']);
    expect(state.rules).toHaveLength(1);
    const r = state.rules[0]! as {
      id: number;
      action: { type: string; requestHeaders: Array<{ header: string; operation: string; value: string }> };
      condition: { tabIds: number[]; requestDomains?: string[] };
    };
    expect(r.id).toBe(8); // RULE_BASE(1) + tabId
    expect(r.action.type).toBe('modifyHeaders');
    expect(r.action.requestHeaders[0]).toMatchObject({ header: 'Referer', operation: 'set', value: 'https://site/' });
    expect(r.condition.tabIds).toEqual([7]);
    expect(r.condition.requestDomains).toEqual(['cdn.example']); // B2: scoped to the granted host
  });

  it('apply() with no headers just clears the tab rule', async () => {
    const inj = new DnrInjector();
    await inj.apply(3, { referer: 'https://x/' }, ['x']);
    expect(state.rules).toHaveLength(1);
    await inj.apply(3, {}); // empty → remove
    expect(state.rules).toHaveLength(0);
  });

  it('reconcile() drops rules whose tab is gone, keeps live ones (B3)', async () => {
    const inj = new DnrInjector();
    await inj.apply(10, { referer: 'https://a/' }, ['a']); // rule id 11
    await inj.apply(20, { referer: 'https://b/' }, ['b']); // rule id 21
    await inj.reconcile([20]); // only tab 20 still exists
    expect(state.rules.map((r) => r.id)).toEqual([21]);
  });
});
