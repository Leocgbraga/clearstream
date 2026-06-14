import { describe, it, expect } from 'vitest';
import {
  isManifestUrl,
  canonicalKey,
  classifyByUrl,
  scoreStream,
  dedupeAndRank,
} from '@/core/detection';
import type { CapturedStream } from '@/core/types';

const mk = (over: Partial<CapturedStream> & { manifestUrl: string }): CapturedStream => ({
  key: canonicalKey(over.manifestUrl),
  tabId: 1,
  frameId: 0,
  pageUrl: 'https://site.example/watch',
  replayHeaders: {},
  createdAt: 0,
  ...over,
});

describe('isManifestUrl', () => {
  it('matches .m3u8/.mpd with end, query, or hash', () => {
    expect(isManifestUrl('https://x/y.m3u8')).toBe(true);
    expect(isManifestUrl('https://x/y.mpd')).toBe(true);
    expect(isManifestUrl('https://x/y.m3u8?token=abc')).toBe(true);
    expect(isManifestUrl('https://x/y.m3u8#frag')).toBe(true);
    expect(isManifestUrl('https://x/Y.M3U8')).toBe(true); // case-insensitive
  });
  it('rejects non-manifests', () => {
    expect(isManifestUrl('https://x/y.mp4')).toBe(false);
    expect(isManifestUrl('https://x/m3u8.html')).toBe(false); // not the extension
    expect(isManifestUrl('https://x/y.ts')).toBe(false);
  });
});

describe('canonicalKey', () => {
  it('strips common cache-busters and lowercases, keeping real params', () => {
    const a = canonicalKey('https://CDN.example/Live/master.m3u8?t=1&cb=2&_=3&token=keep');
    const b = canonicalKey('https://cdn.example/Live/master.m3u8?t=9&cb=8&_=7&token=keep');
    expect(a).toBe(b); // differ only by cache-busters → same key
    expect(a).toContain('token=keep');
    expect(a).not.toContain('cb=');
  });
  it('falls back to the lowercased input on an invalid URL', () => {
    expect(canonicalKey('NOT A URL')).toBe('not a url');
  });
});

describe('classifyByUrl', () => {
  it('flags master-ish names as master, else unknown', () => {
    expect(classifyByUrl('https://x/master.m3u8')).toBe('master');
    expect(classifyByUrl('https://x/playlist.m3u8')).toBe('master');
    expect(classifyByUrl('https://x/chunklist.m3u8')).toBe('master');
    expect(classifyByUrl('https://x/index.m3u8')).toBe('master');
    expect(classifyByUrl('https://x/manifest.mpd')).toBe('master');
    expect(classifyByUrl('https://x/video_720.m3u8')).toBe('unknown');
  });
});

describe('scoreStream', () => {
  it('ranks master > media, penalizes ad hosts, rewards a captured referer', () => {
    expect(scoreStream(mk({ manifestUrl: 'https://x/a.m3u8', kind: 'master' }))).toBe(100);
    expect(scoreStream(mk({ manifestUrl: 'https://x/a.m3u8', kind: 'media' }))).toBe(40);
    // ad host: 100 (master) − 100 (ad) = 0
    expect(scoreStream(mk({ manifestUrl: 'https://doubleclick.net/a.m3u8', kind: 'master' }))).toBe(0);
    // captured referer adds 5
    expect(
      scoreStream(
        mk({ manifestUrl: 'https://x/a.m3u8', kind: 'master', replayHeaders: { referer: 'https://x/' } }),
      ),
    ).toBe(105);
  });
});

describe('dedupeAndRank', () => {
  it('dedupes by canonical key, keeping the newest capture', () => {
    const out = dedupeAndRank([
      mk({ manifestUrl: 'https://x/a.m3u8?cb=1', kind: 'master', createdAt: 10 }),
      mk({ manifestUrl: 'https://x/a.m3u8?cb=2', kind: 'master', createdAt: 20 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.createdAt).toBe(20);
  });
  it('ranks master ahead of media ahead of ad-stub', () => {
    const out = dedupeAndRank([
      mk({ manifestUrl: 'https://ads.example/ad.m3u8', kind: 'master', createdAt: 5 }),
      mk({ manifestUrl: 'https://x/media.m3u8', kind: 'media', createdAt: 5 }),
      mk({ manifestUrl: 'https://x/clean-master.m3u8', kind: 'master', createdAt: 5 }),
    ]);
    expect(out.map((s) => s.manifestUrl)).toEqual([
      'https://x/clean-master.m3u8',
      'https://x/media.m3u8',
      'https://ads.example/ad.m3u8',
    ]);
  });
});
