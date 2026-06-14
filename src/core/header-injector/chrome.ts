// Chrome/Edge backend: declarativeNetRequest SESSION rules with modifyHeaders, scoped to the
// player tab. `tabIds` conditions are session-rules-only; one rule per tab (id derived from tabId).
// `set` (unlike `append`) has no header allowlist, so Referer/Cookie/User-Agent all work. We do NOT
// scope by requestDomains so segments on a different host than the manifest are still covered;
// modifyHeaders only acts on hosts we hold permission for (granted per-CDN at "Watch"). Origin and
// Sec-Fetch-* are browser-enforced and cannot be set — those CDNs stay unplayable in-browser.
import { browser } from 'wxt/browser';
import type { ReplayHeaders } from '@/core/types';
import type { HeaderInjector } from './types';

const RULE_BASE = 1; // keep rule ids ≥ 1 even if a tab id is 0

const ruleId = (tabId: number): number => RULE_BASE + tabId;

type ModifyHeader = { header: string; operation: 'set'; value: string };

function toModifyHeaders(h: ReplayHeaders): ModifyHeader[] {
  const out: ModifyHeader[] = [];
  if (h.referer) out.push({ header: 'Referer', operation: 'set', value: h.referer });
  if (h.cookie) out.push({ header: 'Cookie', operation: 'set', value: h.cookie });
  if (h.userAgent) out.push({ header: 'User-Agent', operation: 'set', value: h.userAgent });
  return out;
}

export class DnrInjector implements HeaderInjector {
  async apply(tabId: number, headers: ReplayHeaders): Promise<void> {
    const requestHeaders = toModifyHeaders(headers);
    const id = ruleId(tabId);
    if (requestHeaders.length === 0) {
      await browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id] });
      return;
    }
    await browser.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [id],
      addRules: [
        {
          id,
          priority: 1,
          action: { type: 'modifyHeaders', requestHeaders },
          condition: {
            tabIds: [tabId],
            resourceTypes: ['xmlhttprequest', 'media', 'other'],
          },
        },
      ],
    });
  }

  async clear(tabId: number): Promise<void> {
    await browser.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId(tabId)] });
  }
}
