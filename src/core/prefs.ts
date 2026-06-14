// Durable user prefs + learned reliability data, in storage.local (survives browser restart, stays
// on-device). Two things: remembered volume/mute, and the header set that produced healthy playback
// per CDN host (so the next watch on that host starts with what worked — the "it learns" feature).
import { browser } from 'wxt/browser';
import type { ReplayHeaders } from './types';

const VOLUME_KEY = 'prefs:volume';
const cdnKey = (host: string): string => `cdn:${host}`;

export interface VolumePref {
  volume: number;
  muted: boolean;
}

export async function loadVolume(): Promise<VolumePref | null> {
  const r = await browser.storage.local.get(VOLUME_KEY);
  return (r[VOLUME_KEY] as VolumePref | undefined) ?? null;
}

export async function saveVolume(pref: VolumePref): Promise<void> {
  await browser.storage.local.set({ [VOLUME_KEY]: pref });
}

/** Remember the headers that produced healthy playback for `host`. */
export async function rememberWorkingHeaders(host: string, headers: ReplayHeaders): Promise<void> {
  if (!host || Object.keys(headers).length === 0) return;
  await browser.storage.local.set({ [cdnKey(host)]: headers });
}

/** Recall the last-known-good headers for `host` (used when the current capture has none). */
export async function recallWorkingHeaders(host: string): Promise<ReplayHeaders | null> {
  if (!host) return null;
  const k = cdnKey(host);
  const r = await browser.storage.local.get(k);
  return (r[k] as ReplayHeaders | undefined) ?? null;
}
