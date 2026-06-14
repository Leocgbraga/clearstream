import { describe, it, expect } from 'vitest';
import { rankMirrorCandidates } from '@/core/resolver/harvest';
import { deriveMasterCandidates, isMasterPlaylist } from '@/core/resolver/master-probe';

describe('rankMirrorCandidates', () => {
  const PAGE = 'https://aggregator.test/links/event-1';

  it('ranks iframes highest, then embed-path + stream-text links; drops noise + the page itself', () => {
    const out = rankMirrorCandidates({
      pageUrl: PAGE,
      iframes: ['https://embed.test/e/abc'],
      links: [
        { href: 'https://mirror.test/embed/xyz', text: 'Link 1 HD' },
        { href: 'https://aggregator.test/about', text: 'About us' }, // noise
        { href: 'https://facebook.com/share', text: 'Share' }, // noise
        { href: PAGE, text: 'this page' }, // self
        { href: 'https://nav.test/home', text: 'Home' }, // noise
      ],
    });
    expect(out[0]).toBe('https://embed.test/e/abc'); // iframe wins
    expect(out).toContain('https://mirror.test/embed/xyz');
    expect(out).not.toContain('https://facebook.com/share');
    expect(out).not.toContain('https://aggregator.test/about');
    expect(out).not.toContain(PAGE);
  });

  it('dedupes (ignoring #fragments), rejects non-http(s), and caps at max', () => {
    const out = rankMirrorCandidates(
      {
        pageUrl: PAGE,
        iframes: [],
        links: [
          { href: 'https://m.test/stream/1#a', text: 'Stream 1' },
          { href: 'https://m.test/stream/1#b', text: 'Stream 1' }, // dupe (fragment only)
          { href: 'javascript:void(0)', text: 'Watch HD' }, // rejected scheme
          { href: 'https://m.test/player/2', text: 'Server 2' },
          { href: 'https://m.test/player/3', text: 'Server 3' },
        ],
      },
      2,
    );
    expect(out).toHaveLength(2); // cap
    expect(out.filter((u) => u.startsWith('https://m.test/stream/1'))).toHaveLength(1); // deduped
    expect(out.some((u) => u.startsWith('javascript:'))).toBe(false);
  });
});

describe('deriveMasterCandidates', () => {
  it('derives sibling master URLs from a variant, excluding the current file, keeping query', () => {
    const out = deriveMasterCandidates('https://cdn.test/v/abc/720p.m3u8?t=xyz');
    expect(out).toContain('https://cdn.test/v/abc/master.m3u8?t=xyz');
    expect(out).toContain('https://cdn.test/v/abc/index.m3u8?t=xyz');
    expect(out.every((u) => !u.includes('720p.m3u8'))).toBe(true);
  });
  it('excludes the current filename when it is already master.m3u8', () => {
    const out = deriveMasterCandidates('https://cdn.test/v/abc/master.m3u8');
    expect(out.some((u) => u.endsWith('/master.m3u8'))).toBe(false);
  });
  it('returns [] for a non-URL', () => {
    expect(deriveMasterCandidates('not a url')).toEqual([]);
  });
});

describe('isMasterPlaylist', () => {
  it('detects a master by EXT-X-STREAM-INF, not a media playlist', () => {
    expect(isMasterPlaylist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nlo.m3u8')).toBe(true);
    expect(isMasterPlaylist('#EXTM3U\n#EXTINF:2.0,\nseg0.ts')).toBe(false);
  });
});
