// Sets up hls.js with tuned config + the live-ify pLoader, and wires hls.levels into
// media-chrome's quality menu via the media-tracks polyfill. Phase 4 adds auto-failover.
// See docs/research/07-player-engine.md.
import 'media-tracks/polyfill';
import Hls from 'hls.js';
import type { ErrorData, Level } from 'hls.js';
import { createLivePLoader } from './endlist-loader';

export interface PlayerHandle {
  hls?: Hls;
  destroy(): void;
}

export interface PlayerOptions {
  /** Strip #EXT-X-ENDLIST each poll so rolling-window streams stay live (default true). */
  forceLive?: boolean;
  onError?: (data: ErrorData) => void;
}

// Tuned for flaky live CDNs (see research 07): be patient, don't chase the live edge, cap quality.
const TUNED = {
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
  // Prefer hls.js (MSE) wherever it works — Chrome/Edge/Firefox. NOTE: do NOT check
  // canPlayType('application/vnd.apple.mpegurl') first — Chromium returns "maybe" for it but
  // can't actually decode HLS natively, so a native-first check breaks playback there.
  if (Hls.isSupported()) {
    const hls = new Hls({
      ...TUNED,
      // hls.js typings don't accept our loosely-typed loader class; the runtime contract is correct.
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
  // No loader hook here (no ENDLIST strip / header injection).
  if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = src;
    void video.play().catch(() => {});
    return {
      destroy() {
        video.removeAttribute('src');
        video.load();
      },
    };
  }

  throw new Error('This browser cannot play HLS (no Media Source Extensions or native HLS).');
}

/** Mirror hls.js video levels into video.videoRenditions so media-chrome can show a quality menu. */
function populateRenditions(video: HTMLVideoElement, levels: Level[]): void {
  if (!video.videoRenditions) return;
  const track = video.addVideoTrack('main');
  track.selected = true;
  for (const level of levels) {
    if (!level.height) continue; // skip audio-only renditions
    track.addRendition(level.url?.[0] ?? '', level.width, level.height, level.videoCodec, level.bitrate);
  }
}
