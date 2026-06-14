// Custom hls.js playlist loader that strips live-blocking markers on EVERY manifest/level poll,
// so rolling-window streams that (wrongly) ship #EXT-X-ENDLIST keep refreshing. This is the
// in-browser port of the Python tool's proxy.py live-ify (which stripped these unconditionally
// and worked). A one-shot Blob would stall — the rewrite must run on each poll.
// See docs/research/07-player-engine.md (§3).
import Hls from 'hls.js';

/** Strip #EXT-X-ENDLIST so a rolling-window playlist keeps refreshing — BUT respect a stream that
 *  declares itself VOD (#EXT-X-PLAYLIST-TYPE:VOD): stripping a true VOD's ENDLIST makes hls.js seek
 *  to a non-existent live edge and never play. Rolling-window live streams don't declare VOD. */
export function makeLive(text: string): string {
  if (/#EXT-X-PLAYLIST-TYPE:\s*VOD/i.test(text)) return text;
  return text.replace(/^#EXT-X-ENDLIST[^\n]*\n?/gim, '');
}

/** Returns a pLoader class (extends hls.js's default loader) that live-ifies playlist responses.
 *  Typed loosely: hls.js loader generics are intricate and the config `pLoader` field is permissive.
 *  TODO(Phase 2.1): media-sequence liveness guard so genuine VOD isn't forced into a live UI. */
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
