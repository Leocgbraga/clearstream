// Only ever load http(s) manifests. Rejects javascript:/data:/blob:/file: so a crafted
// player.html#src= (or a spoofed OPEN_PLAYER message) can't point the player at a local file or a
// code-bearing URI. Returns the normalized href, or null if missing/unsafe.
export function safeHttpUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}
