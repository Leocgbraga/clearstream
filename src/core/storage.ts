// Per-tab detected streams live in session storage (ephemeral, cleared on browser close,
// keeps captured data off disk). See docs/research/06-capture-engine.md (§3).
import { browser } from 'wxt/browser';
import type { CapturedStream } from './types';
import { dedupeAndRank } from './detection';

const tabKey = (tabId: number) => `streams:${tabId}`;

export async function getStreams(tabId: number): Promise<CapturedStream[]> {
  const k = tabKey(tabId);
  const r = await browser.storage.session.get(k);
  return (r[k] as CapturedStream[] | undefined) ?? [];
}

export async function addStreams(
  tabId: number,
  incoming: CapturedStream[],
): Promise<CapturedStream[]> {
  const merged = dedupeAndRank([...(await getStreams(tabId)), ...incoming]);
  await browser.storage.session.set({ [tabKey(tabId)]: merged });
  return merged;
}

export async function clearTab(tabId: number): Promise<void> {
  await browser.storage.session.remove(tabKey(tabId));
}
