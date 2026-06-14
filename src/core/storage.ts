// Per-tab detected streams live in session storage (ephemeral, cleared on browser close,
// keeps captured data off disk). See docs/research/06-capture-engine.md (§3).
import { browser } from 'wxt/browser';
import type { CapturedStream } from './types';
import { dedupeAndRank } from './detection';

const tabKey = (tabId: number) => `streams:${tabId}`;

// storage.session has no atomic read-modify-write, and detections arrive concurrently (the passive
// webRequest observer + a popup DETECT scan can both write the same tab in the same tick). Serialize
// writes per tab onto a promise chain so a read→merge→write can't interleave and drop a detection.
const writeQueue = new Map<number, Promise<unknown>>();

export async function getStreams(tabId: number): Promise<CapturedStream[]> {
  const k = tabKey(tabId);
  const r = await browser.storage.session.get(k);
  return (r[k] as CapturedStream[] | undefined) ?? [];
}

export async function addStreams(
  tabId: number,
  incoming: CapturedStream[],
): Promise<CapturedStream[]> {
  const prev = writeQueue.get(tabId) ?? Promise.resolve();
  const result = prev.then(async () => {
    const merged = dedupeAndRank([...(await getStreams(tabId)), ...incoming]);
    await browser.storage.session.set({ [tabKey(tabId)]: merged });
    return merged;
  });
  // Keep the chain alive even if one write rejects (don't poison subsequent writes for this tab).
  writeQueue.set(tabId, result.catch(() => undefined));
  return result;
}

export async function clearTab(tabId: number): Promise<void> {
  writeQueue.delete(tabId);
  await browser.storage.session.remove(tabKey(tabId));
}
