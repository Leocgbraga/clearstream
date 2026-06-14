// Pure HLS-playlist string transform — no hls.js/DOM imports, so it's unit-testable in isolation.
// Used by the live-ify pLoader (endlist-loader.ts) on every manifest/level poll.

/** Strip #EXT-X-ENDLIST so a rolling-window live playlist that *wrongly* ships ENDLIST keeps
 *  refreshing — BUT don't force-live a genuine VOD (stripping a VOD's ENDLIST makes hls.js seek to a
 *  non-existent live edge and never play). We respect, in order: an explicit VOD declaration; a
 *  playlist with no ENDLIST (already live); and the media-sequence/length heuristic — a long list
 *  starting at media-sequence 0 is VOD, whereas a short rolling window (few segments, advancing or
 *  absent sequence) is the broken-live case we want to fix. See research/07 (§3), decisions D8. */
export function makeLive(text: string): string {
  if (/#EXT-X-PLAYLIST-TYPE:\s*VOD/i.test(text)) return text; // explicit VOD
  if (!/#EXT-X-ENDLIST/i.test(text)) return text; // already live — nothing to strip
  const seqMatch = text.match(/#EXT-X-MEDIA-SEQUENCE:\s*(\d+)/i);
  const seq = seqMatch ? Number(seqMatch[1]) : 0;
  const segCount = (text.match(/#EXTINF/gi) ?? []).length;
  // A long, fixed list from sequence 0 is a real VOD → keep ENDLIST.
  if (seq === 0 && segCount > 20) return text;
  // Otherwise treat as a rolling live window that shouldn't have shipped ENDLIST → strip it.
  return text.replace(/^#EXT-X-ENDLIST[^\n]*\n?/gim, '');
}
