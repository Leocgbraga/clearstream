// Pure HLS-playlist string transform — no hls.js/DOM imports, so it's unit-testable in isolation.
// Used by the live-ify pLoader (endlist-loader.ts) on every manifest/level poll.

/** Strip #EXT-X-ENDLIST so a rolling-window playlist keeps refreshing — BUT respect a stream that
 *  declares itself VOD (#EXT-X-PLAYLIST-TYPE:VOD): stripping a true VOD's ENDLIST makes hls.js seek
 *  to a non-existent live edge and never play. Rolling-window live streams don't declare VOD. */
export function makeLive(text: string): string {
  if (/#EXT-X-PLAYLIST-TYPE:\s*VOD/i.test(text)) return text;
  return text.replace(/^#EXT-X-ENDLIST[^\n]*\n?/gim, '');
}
