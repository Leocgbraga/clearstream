import { describe, it, expect } from 'vitest';
import { parseEvents, matchup, titleFromSlug, sportOf, statusOf } from '@/core/resolver/events';

describe('matchup', () => {
  it('extracts a clean "A vs B" from a noisy card, stripping emoji + trailing metadata', () => {
    expect(matchup('Los Angeles Angels vs Tampa Bay Rays')).toBe('Los Angeles Angels vs Tampa Bay Rays');
    expect(matchup('⚾ Boston Red Sox vs Texas Rangers Sunday, Jun 14, 2026, 7:20 PM ET MLB LIVE')).toBe(
      'Boston Red Sox vs Texas Rangers',
    );
    expect(matchup('⚽ Sweden vs Tunisia 10:00 PM ET Soccer 2 hours from now')).toBe('Sweden vs Tunisia');
    expect(matchup('Heat vs Knicks · NBA · 9:30 PM ET')).toBe('Heat vs Knicks');
  });
  it('does not truncate team names that start with a month abbreviation', () => {
    expect(matchup('Philadelphia Phillies vs Miami Marlins Monday, Jun 15, 2026, 6:40 PM ET')).toBe(
      'Philadelphia Phillies vs Miami Marlins',
    );
    expect(matchup('Seattle Mariners vs Houston Astros 7:10 PM ET')).toBe('Seattle Mariners vs Houston Astros');
  });
  it('handles @ and v. separators', () => {
    expect(matchup('Yankees @ Red Sox')).toBe('Yankees vs Red Sox');
  });
  it('returns null when there is no matchup', () => {
    expect(matchup('RAW #1725')).toBeNull();
    expect(matchup('Watch HD')).toBeNull();
  });
});

describe('titleFromSlug', () => {
  it('de-slugifies a matchup, stripping ids + routing prefixes', () => {
    expect(titleFromSlug('lakers-vs-celtics-99')).toBe('Lakers vs Celtics');
    expect(titleFromSlug('germany-vs-curacao-2391733')).toBe('Germany vs Curacao');
    expect(titleFromSlug('event-lakers-vs-celtics-99')).toBe('Lakers vs Celtics');
  });
  it('returns null for non-matchup slugs', () => {
    expect(titleFromSlug('nba')).toBeNull();
    expect(titleFromSlug('8821')).toBeNull();
  });
});

describe('sportOf / statusOf', () => {
  it('detects sport from keyword or emoji', () => {
    expect(sportOf('Boston Red Sox vs Texas Rangers MLB')).toBe('MLB');
    expect(sportOf('⚽ Sweden vs Tunisia')).toBe('Soccer');
    expect(sportOf('🥊 UFC Freedom 250 Topuria vs Gaethje UFC LIVE')).toBe('UFC/MMA'); // league text beats 🥊
    expect(sportOf('Lakers vs Celtics')).toBeUndefined();
  });
  it('classifies status (and does not read "from now" as live)', () => {
    expect(statusOf('MLB LIVE').status).toBe('live');
    expect(statusOf('MLB Finished').status).toBe('finished');
    expect(statusOf('Soccer 2 hours from now').status).toBe('upcoming');
    expect(statusOf('starts 10:00 PM ET').status).toBe('upcoming');
    expect(statusOf('Lakers vs Celtics').status).toBe('unknown');
  });
});

describe('parseEvents', () => {
  const PAGE = 'https://streams.test/';

  it('parses a streameast-style card layout (matchup in link text); drops noise + category links', () => {
    const out = parseEvents({
      pageUrl: PAGE,
      anchors: [
        { href: 'https://streams.test/red-sox-vs-rangers-1', text: '⚾ Boston Red Sox vs Texas Rangers Sunday, Jun 14, 7:20 PM ET MLB LIVE' },
        { href: 'https://streams.test/sweden-vs-tunisia-3', text: '⚽ Sweden vs Tunisia Sunday, Jun 14, 10:00 PM ET Soccer 2 hours from now' },
        { href: 'https://streams.test/angels-vs-rays-0', text: '⚾ Los Angeles Angels vs Tampa Bay Rays Sunday, Jun 14, 4:07 PM ET MLB Finished' },
        { href: 'https://facebook.com/share', text: 'Share on Facebook' }, // noise
        { href: 'https://streams.test/nba', text: 'NBA' }, // category, no matchup
        { href: PAGE, text: 'Home' }, // the page itself
      ],
    });
    expect(out.map((e) => e.title)).toEqual([
      'Boston Red Sox vs Texas Rangers', // live first
      'Sweden vs Tunisia', // upcoming next
      'Los Angeles Angels vs Tampa Bay Rays', // finished last
    ]);
    expect(out[0]).toMatchObject({ status: 'live', sport: 'MLB' });
    expect(out[1]).toMatchObject({ status: 'upcoming', sport: 'Soccer' });
    expect(out[2]!.status).toBe('finished');
    expect(out.some((e) => /facebook/.test(e.url))).toBe(false);
  });

  it('parses a crackstreams-style layout — matchup in the slug OR a sibling row, generic link text', () => {
    const out = parseEvents({
      pageUrl: PAGE,
      anchors: [
        // matchup only in the slug:
        { href: 'https://streams.test/event-lakers-vs-celtics-99', text: 'Watch HD', context: 'NBA Lakers vs Celtics 8:00 PM ET LIVE' },
        // matchup only in the context (numeric slug, generic text):
        { href: 'https://streams.test/game/8821', text: 'Stream', context: 'Heat vs Knicks · NBA · 9:30 PM ET' },
        { href: 'https://streams.test/nba', text: 'NBA', context: 'Categories NBA NFL MLB' }, // category → drop
      ],
    });
    expect(out.map((e) => e.title).sort()).toEqual(['Heat vs Knicks', 'Lakers vs Celtics']);
    expect(out.find((e) => e.title === 'Lakers vs Celtics')).toMatchObject({ status: 'live', sport: 'NBA' });
  });

  it('dedupes a game with many per-mirror links into one row', () => {
    const out = parseEvents({
      pageUrl: PAGE,
      anchors: [
        { href: 'https://streams.test/lakers-vs-celtics-9', text: '⚽ Lakers vs Celtics LIVE' },
        { href: 'https://streams.test/lakers-vs-celtics-9?q=sd', text: '⚽ Lakers vs Celtics LIVE' },
        { href: 'https://streams.test/lakers-vs-celtics-9#hd', text: '⚽ Lakers vs Celtics LIVE' },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe('Lakers vs Celtics');
  });

  it('accepts non-"vs" events (e.g. WWE/UFC cards) when sport + status signals are present', () => {
    const out = parseEvents({
      pageUrl: PAGE,
      anchors: [{ href: 'https://streams.test/raw-1725', text: '🤼 RAW #1725 Sunday, Jun 14, 8:00 PM ET WWE LIVE' }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ title: 'RAW #1725', sport: 'Wrestling', status: 'live' });
  });

  it('ingests JSON-LD events and caps the result', () => {
    const ld = parseEvents({
      pageUrl: PAGE,
      anchors: [],
      jsonld: [{ name: 'Real Madrid vs Barcelona', startDate: '2026-06-15T19:00:00Z', url: 'https://streams.test/clasico' }],
    });
    expect(ld[0]).toMatchObject({ title: 'Real Madrid vs Barcelona', status: 'upcoming' });

    const many = Array.from({ length: 60 }, (_, i) => ({ href: `https://streams.test/a${i}-vs-b${i}-${i}`, text: `A${i} vs B${i} LIVE` }));
    expect(parseEvents({ pageUrl: PAGE, anchors: many }, 5)).toHaveLength(5);
  });
});
