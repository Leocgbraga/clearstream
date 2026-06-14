// Auto-failover across detected mirror streams — the in-browser port of the Python tool's
// player.py decode-health failover. Healthy = fragments loading / currentTime advancing; a streak
// of segment errors or buffer stalls, or a frozen-progress watchdog, advances to the next mirror.
// A fatal error first attempts ONE in-place recovery (startLoad / recoverMediaError) on a deadline:
// if no healthy fragment arrives in time, we fail over (so a dead manifest can't wedge us).
// See docs/research/07-player-engine.md (§5) and docs/research/09-ux-permissions.md (§3).
import Hls from 'hls.js';
import type { CapturedStream } from '@/core/types';
import { createPlayer, type PlayerHandle } from './hls-controller';

const DEGRADED_STREAK = 5; // === player.py _DEGRADED_STREAK
const MIN_PLAY_MS = 8000; // === player.py _MIN_PLAY_SECS (anti-flap)
const WATCHDOG_MS = 2000;
const MAX_FROZEN_TICKS = 4; // ~8s of no progress while "playing"
const RECOVERY_MS = 5000; // grace for an in-place recovery to bear fruit before failing over

export interface FailoverStatus {
  index: number;
  total: number;
  message: string;
  failed?: boolean;
}

export interface FailoverHooks {
  /** Install header injection for mirror `index` before it plays (no-op for direct links). */
  prepareMirror(index: number): Promise<void>;
  onStatus(status: FailoverStatus): void;
}

export interface FailoverController {
  /** Manually pin a specific mirror (the "Sources" dropdown escape hatch). */
  select(index: number): void;
  destroy(): void;
}

export function createFailoverController(
  video: HTMLVideoElement,
  streams: CapturedStream[],
  hooks: FailoverHooks,
): FailoverController {
  let index = -1;
  let handle: PlayerHandle | null = null;
  let errStreak = 0;
  let recoveryUsed = false; // one in-place recovery attempt per mirror, then fail over
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  let playStartTs = 0;
  let lastTime = 0;
  let frozenTicks = 0;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  let destroyed = false;

  const clearTimers = (): void => {
    if (watchdog !== undefined) clearInterval(watchdog);
    if (recoveryTimer !== undefined) clearTimeout(recoveryTimer);
    watchdog = undefined;
    recoveryTimer = undefined;
  };

  const healthy = (): void => {
    errStreak = 0;
    frozenTicks = 0;
    if (recoveryTimer !== undefined) clearTimeout(recoveryTimer);
    recoveryTimer = undefined;
  };

  function onError(data: { fatal?: boolean; type?: string; details?: string }): void {
    if (destroyed) return;
    if (!data.fatal) {
      const degrading =
        data.type === Hls.ErrorTypes.NETWORK_ERROR ||
        data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR ||
        (data.details?.includes('rag') ?? false); // fragLoad / fragParsing errors
      if (degrading && ++errStreak >= DEGRADED_STREAK) failover('Stream degraded');
      return;
    }
    // Fatal: try ONE in-place recovery on a deadline; if it doesn't recover, fail over.
    const hls = handle?.hls;
    if (hls && !recoveryUsed && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
      recoveryUsed = true;
      hls.startLoad();
      armRecoveryDeadline();
    } else if (hls && !recoveryUsed && data.type === Hls.ErrorTypes.MEDIA_ERROR) {
      recoveryUsed = true;
      hls.recoverMediaError();
      armRecoveryDeadline();
    } else {
      failover(`Fatal error (${data.details ?? data.type ?? 'unknown'})`);
    }
  }

  function armRecoveryDeadline(): void {
    if (recoveryTimer !== undefined) clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(() => {
      if (!destroyed) failover('Source unrecoverable');
    }, RECOVERY_MS);
  }

  function failover(reason: string): void {
    if (destroyed) return;
    void play(index + 1, reason);
  }

  function startWatchdog(): void {
    lastTime = 0;
    watchdog = setInterval(() => {
      if (destroyed || video.paused || video.readyState < 2) return;
      if (video.currentTime <= lastTime + 0.05) {
        if (++frozenTicks >= MAX_FROZEN_TICKS && Date.now() - playStartTs > MIN_PLAY_MS) {
          failover('Playback stalled');
        }
      } else {
        frozenTicks = 0;
      }
      lastTime = video.currentTime;
    }, WATCHDOG_MS);
  }

  async function play(i: number, reason = ''): Promise<void> {
    handle?.destroy();
    handle = null;
    clearTimers();
    if (i >= streams.length) {
      hooks.onStatus({ index, total: streams.length, message: 'All sources failed.', failed: true });
      return;
    }
    index = i;
    const stream = streams[i]!;
    hooks.onStatus({
      index: i,
      total: streams.length,
      message: reason ? `${reason} — switched to source ${i + 1} of ${streams.length}` : '',
    });

    await hooks.prepareMirror(i); // install this mirror's headers before any request
    if (destroyed) return;

    errStreak = 0;
    frozenTicks = 0;
    recoveryUsed = false;
    playStartTs = Date.now();
    try {
      handle = createPlayer(video, stream.manifestUrl, {
        forceLive: true,
        onFragLoaded: healthy,
        onError,
      });
      startWatchdog();
    } catch (e) {
      failover((e as Error).message);
    }
  }

  void play(0);

  return {
    select(i: number): void {
      if (i >= 0 && i < streams.length && i !== index) void play(i);
    },
    destroy(): void {
      destroyed = true;
      clearTimers();
      handle?.destroy();
      handle = null;
    },
  };
}
