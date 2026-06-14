// Custom hls.js playlist loader that strips live-blocking markers on EVERY manifest/level poll,
// so rolling-window streams that (wrongly) ship #EXT-X-ENDLIST keep refreshing. This is the
// in-browser port of the Python tool's proxy.py live-ify (which stripped these unconditionally
// and worked). A one-shot Blob would stall — the rewrite must run on each poll.
// See docs/research/07-player-engine.md (§3).
import Hls from 'hls.js';
import { makeLive } from './live-playlist';

// makeLive (the pure ENDLIST/VOD heuristic) lives in ./live-playlist so it's testable without
// importing hls.js. Re-exported here for back-compat with any existing imports.
export { makeLive } from './live-playlist';

/** Returns a pLoader class (extends hls.js's default loader) that live-ifies playlist responses.
 *  Typed loosely: hls.js loader generics are intricate and the config `pLoader` field is permissive.
 *  (The media-sequence liveness guard that keeps genuine VOD out of the live UI lives in makeLive,
 *  in live-playlist.ts.) */
export function createLivePLoader(forceLive: boolean): unknown {
  const Base = Hls.DefaultConfig.loader as unknown as new (config: unknown) => {
    load(context: { type?: string }, config: unknown, callbacks: { onSuccess: (...a: unknown[]) => void }): void;
  };

  return class LivePLoader extends Base {
    load(
      context: { type?: string },
      config: unknown,
      callbacks: { onSuccess: (...a: unknown[]) => void },
    ): void {
      if (forceLive && (context.type === 'manifest' || context.type === 'level')) {
        const onSuccess = callbacks.onSuccess;
        callbacks.onSuccess = (response: unknown, ...rest: unknown[]) => {
          const r = response as { data?: unknown };
          if (typeof r.data === 'string') r.data = makeLive(r.data);
          onSuccess(response, ...rest);
        };
      }
      super.load(context, config, callbacks);
    }
  };
}
