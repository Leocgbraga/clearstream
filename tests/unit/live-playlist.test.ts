import { describe, it, expect } from 'vitest';
import { makeLive } from '@/core/player/live-playlist';

describe('makeLive', () => {
  it('strips #EXT-X-ENDLIST from a rolling-window playlist', () => {
    const live = '#EXTM3U\n#EXTINF:6,\nseg1.ts\n#EXT-X-ENDLIST\n';
    const out = makeLive(live);
    expect(out).not.toContain('#EXT-X-ENDLIST');
    expect(out).toContain('seg1.ts');
  });
  it('is case-insensitive', () => {
    expect(makeLive('#extm3u\n#ext-x-endlist\n')).not.toMatch(/endlist/i);
  });
  it('respects a true VOD (keeps ENDLIST so hls.js does not seek a phantom live edge)', () => {
    const vod = '#EXTM3U\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:6,\nseg1.ts\n#EXT-X-ENDLIST\n';
    expect(makeLive(vod)).toBe(vod);
  });
  it('respects VOD declared with a space after the colon', () => {
    const vod = '#EXT-X-PLAYLIST-TYPE: VOD\n#EXT-X-ENDLIST\n';
    expect(makeLive(vod)).toBe(vod);
  });
  it('leaves a playlist with no ENDLIST untouched', () => {
    const t = '#EXTM3U\n#EXTINF:6,\nseg1.ts\n';
    expect(makeLive(t)).toBe(t);
  });
});
