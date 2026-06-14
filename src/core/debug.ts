// Debug diagnostics — compiled in ONLY for development builds (`pnpm dev` / `pnpm build:debug`).
// Production (`pnpm build`, the store artifact, and the `pnpm check` / `verify` builds) runs with
// MODE==='production', so DEBUG folds to the literal `false` and every guarded block + dlog body is
// tree-shaken away. This is the "point a debug build at any real site and see what happened" tooling:
// the popup lists what was detected and from which layer; the console shows why playback failed.
// See CONTRIBUTING.md ("Debugging on a real site").
export const DEBUG = import.meta.env.MODE === 'development';

export function dlog(...args: unknown[]): void {
  if (DEBUG) console.debug('%c[ClearStream]', 'color:#14b8a6;font-weight:bold', ...args);
}

/** Map an hls.js-style error to a plain-language "why it didn't play" class. */
export function failureClass(e: { type?: string; details?: string; response?: { code?: number } } | undefined): string {
  if (!e) return 'unknown error';
  const code = e.response?.code;
  const d = (e.details ?? '').toLowerCase();
  if (code === 403) return 'HTTP 403 — gated (Referer/Origin/cookie): grant the host so the extension replays headers';
  if (code === 401) return 'HTTP 401 — auth required (a token in Authorization cannot be replayed)';
  if (code === 404 || code === 410) return `HTTP ${code} — stream gone / segment URL expired`;
  if (d.includes('manifestload')) return 'manifest load failed — CORS/network, or this host is not granted';
  if (d.includes('fragload')) return 'segment load failed — gated or expired segment URLs';
  if (e.type === 'mediaError') return 'media/decode error — unsupported codec or DRM (DRM cannot play)';
  return `${e.type ?? 'error'} / ${e.details ?? '?'}${code ? ` (HTTP ${code})` : ''}`;
}
