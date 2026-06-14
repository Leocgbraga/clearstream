// Best-quality master-playlist probing — POWER build only (off-store). CS_POWER_RESOLVER
//
// When a site loads a single variant/media playlist (e.g. picks 720p directly), we only have that one
// rendition. The master playlist (which lists every quality for adaptive switching) usually sits beside
// it under a conventional name. These pure helpers derive the candidate master URLs to probe and detect
// a master body; the background does the actual (host-permitted) fetch and prefers a master when found.

/** Sibling URLs likely to be the master playlist for a given variant/media playlist URL. */
export function deriveMasterCandidates(variantUrl: string): string[] {
  let u: URL;
  try {
    u = new URL(variantUrl);
  } catch {
    return [];
  }
  const slash = u.pathname.lastIndexOf('/');
  if (slash < 0) return [];
  const dir = u.origin + u.pathname.slice(0, slash + 1);
  const current = u.pathname.slice(slash + 1).toLowerCase();
  const names = ['master.m3u8', 'index.m3u8', 'playlist.m3u8', 'master.txt', 'chunklist.m3u8'];
  // Keep the original query (CDN tokens often apply to the whole directory).
  return names.filter((n) => n !== current).map((n) => dir + n + u.search);
}

/** A master playlist declares variant streams; a media playlist lists segments. */
export function isMasterPlaylist(body: string): boolean {
  return /#EXT-X-STREAM-INF/i.test(body);
}
