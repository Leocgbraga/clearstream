// Sets up hls.js with tuned config + the live-ify pLoader, and wires hls.levels into
// media-chrome's quality menu via the media-tracks polyfill. The failover controller
// (failover.ts) drives multiple of these across detected mirrors.
// See docs/research/07-player-engine.md.
import 'media-tracks/polyfill';
import Hls from 'hls.js';
import type { Level } from 'hls.js';
import { createLivePLoader } from './endlist-loader';

export interface PlayerHandle {
  hls?: Hls;
  destroy(): void;
}

/** Minimal error shape the failover controller acts on. hls.js's ErrorData satisfies it; the native
 *  (Safari) branch synthesizes one so failover works there too. */
export type PlayerError = { fatal?: boolean; type?: string; details?: string };

export interface PlayerOptions {
  /** Strip #EXT-X-ENDLIST each poll so rolling-window streams stay live (default true). */
  forceLive?: boolean;
  /** All player errors (fatal and non-fatal) — the failover controller decides what to do. */
  onError?: (data: PlayerError) => void;
  /** A fragment loaded successfully — the "healthy" signal that resets the failover streak. */
  onFragLoaded?: () => void;
}

// Tuned for flaky live CDNs (see research 07): be patient, don't chase the live edge, cap quality.
const TUNED = {
  // Main-thread demux: MV3's default CSP blocks hls.js's blob-URL worker, and adding `worker-src
  // blob:` to re-enable it trips AMO's custom-CSP review flag — not worth it for ≤1080p streams.
  // Explicit `false` avoids hls.js attempting the worker and silently falling back (with a console error).
  enableWorker: false,
  lowLatencyMode: false,
  capLevelToPlayerSize: true,
  capLevelOnFPSDrop: true,
  backBufferLength: 90,
  manifestLoadingMaxRetry: 4,
  manifestLoadingRetryDelay: 500,
  levelLoadingMaxRetry: 6,
  fragLoadingMaxRetry: 8,
  fragLoadingRetryDelay: 1000,
} as const;

export function createPlayer(
  video: HTMLVideoElement,
  src: string,
  opts: PlayerOptions = {},
): PlayerHandle {
  // Prefer hls.js (MSE) wherever it works — Chrome/Edge/Firefox. Do NOT check canPlayType first:
  // Chromium returns "maybe" for mpegurl but can't decode HLS natively, breaking a native-first check.
  if (Hls.isSupported()) {
    const hls = new Hls({
      ...TUNED,
      pLoader: createLivePLoader(opts.forceLive ?? true) as never,
    });

    let syncing = false; // guards LEVEL_SWITCHED→menu update from re-triggering our change handler
    const onRenditionChange = (): void => {
      if (syncing) return;
      hls.nextLevel = video.videoRenditions?.selectedIndex ?? -1; // -1 = Auto (ABR)
    };

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      populateRenditions(video, hls.levels);
      video.videoRenditions?.addEventListener('change', onRenditionChange);
      void video.play().catch(() => {});
    });

    hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
      if (!video.videoRenditions) return;
      syncing = true;
      try {
        video.videoRenditions.selectedIndex = data.level;
      } catch {
        /* index out of range during teardown */
      }
      syncing = false;
    });

    if (opts.onFragLoaded) hls.on(Hls.Events.FRAG_LOADED, () => opts.onFragLoaded?.());
    if (opts.onError) hls.on(Hls.Events.ERROR, (_e, data) => opts.onError?.(data));

    hls.loadSource(src);
    hls.attachMedia(video);

    return {
      hls,
      destroy() {
        video.videoRenditions?.removeEventListener('change', onRenditionChange);
        hls.destroy();
      },
    };
  }

  // Native HLS (Safari/iOS) — hls.js unsupported, but the browser plays HLS directly.
  // No loader hook here (no ENDLIST strip / header injection), but we DO wire health/error events
  // so the failover controller works on Safari too (a dead mirror must still advance).
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    const onErr = (): void =>
      opts.onError?.({ fatal: true, type: 'networkError', details: 'nativeMediaError' });
    const onProgress = (): void => opts.onFragLoaded?.();
    video.addEventListener('error', onErr);
    video.addEventListener('progress', onProgress);
    video.addEventListener('timeupdate', onProgress);
    video.src = src;
    void video.play().catch(() => {});
    return {
      destroy() {
        video.removeEventListener('error', onErr);
        video.removeEventListener('progress', onProgress);
        video.removeEventListener('timeupdate', onProgress);
        video.removeAttribute('src');
        video.load();
      },
    };
  }

  throw new Error('This browser cannot play HLS (no Media Source Extensions or native HLS).');
}

/** Mirror hls.js video levels into video.videoRenditions so media-chrome can show a quality menu.
 *  Clears any prior renditions first so switching mirrors doesn't accumulate stale entries. */
function populateRenditions(video: HTMLVideoElement, levels: Level[]): void {
  if (!video.videoRenditions) return;
  try {
    for (const t of [...video.videoTracks]) video.removeVideoTrack(t);
  } catch {
    /* nothing to clear */
  }
  const track = video.addVideoTrack('main');
  track.selected = true;
  for (const level of levels) {
    if (!level.height) continue; // skip audio-only renditions
    track.addRendition(level.url?.[0] ?? '', level.width, level.height, level.videoCodec, level.bitrate);
  }
}
