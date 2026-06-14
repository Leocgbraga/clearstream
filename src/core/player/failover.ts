// Auto-failover across detected mirror streams — the in-browser port of the Python tool's
// player.py decode-health failover. Healthy = fragments loading / currentTime advancing; a streak
// of segment errors or buffer stalls, a frozen-progress watchdog, or a never-started connect-timeout
// advances to the next mirror. A fatal error first attempts ONE in-place recovery per error type
// (network → startLoad, media → recoverMediaError) on a deadline; if it doesn't bear fruit, fail over.
//
// Concurrency: every play() captures a monotonic `token`; any later play()/select()/destroy() bumps
// it, so an in-flight play() (parked on `await prepareMirror`) and every deferred callback (watchdog,
// recovery/connect deadlines, error handler) bail when superseded. This prevents the overlapping
// hls.js instances, leaked intervals, and double-advance the audit found.
//
// `createPlayer` is injected (not imported) so the state machine carries no runtime hls.js/DOM
// dependency and is unit-testable in node. See docs/research/07-player-engine.md (§5).
import type { CapturedStream } from '@/core/types';
import type { PlayerHandle, PlayerOptions } from './hls-controller';

// hls.js ErrorTypes/ErrorDetails are stable public string enums; we mirror only the few we act on so
// this module needs no runtime `import Hls`. (Verified against hls.js 1.6.16 dist types.)
const NETWORK_ERROR = 'networkError';
const MEDIA_ERROR = 'mediaError';
const BUFFER_STALLED = 'bufferStalledError';
const FRAG_LOAD_ERROR = 'fragLoadError';
const FRAG_LOAD_TIMEOUT = 'fragLoadTimeOut';
const FRAG_PARSING_ERROR = 'fragParsingError';

export interface FailoverTunables {
  /** Consecutive non-fatal degradations before advancing. */
  degradedStreak: number;
  /** Min playback time before the stall watchdog may fire (anti-flap). */
  minPlayMs: number;
  watchdogMs: number;
  /** Frozen watchdog ticks (~maxFrozenTicks × watchdogMs of no progress) before advancing. */
  maxFrozenTicks: number;
  /** Grace for an in-place recovery to produce a fragment before failing over. */
  recoveryMs: number;
  /** No first fragment within this long after a source starts → advance (covers readyState<2 hangs). */
  connectMs: number;
}

export const DEFAULT_TUNABLES: FailoverTunables = {
  degradedStreak: 5, // === player.py _DEGRADED_STREAK
  minPlayMs: 8000, // === player.py _MIN_PLAY_SECS (anti-flap)
  watchdogMs: 2000,
  maxFrozenTicks: 4, // ~8s of no progress while "playing"
  recoveryMs: 5000,
  connectMs: 12000,
};

export type ErrorAction = 'ignore' | 'degrade' | 'recover-network' | 'recover-media' | 'fatal';

/** Pure decision: what should a given hls.js error event do? (No side effects → unit-testable.) */
export function classifyError(data: { fatal?: boolean; type?: string; details?: string }): ErrorAction {
  if (!data.fatal) {
    const degrading =
      data.type === NETWORK_ERROR ||
      data.details === BUFFER_STALLED ||
      data.details === FRAG_LOAD_ERROR ||
      data.details === FRAG_LOAD_TIMEOUT ||
      data.details === FRAG_PARSING_ERROR;
    return degrading ? 'degrade' : 'ignore';
  }
  if (data.type === NETWORK_ERROR) return 'recover-network';
  if (data.type === MEDIA_ERROR) return 'recover-media';
  return 'fatal';
}

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

export interface FailoverDeps {
  createPlayer: (video: HTMLVideoElement, src: string, opts: PlayerOptions) => PlayerHandle;
  tunables?: Partial<FailoverTunables>;
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
  deps: FailoverDeps,
): FailoverController {
  const { createPlayer } = deps;
  const T = { ...DEFAULT_TUNABLES, ...deps.tunables };

  let index = -1;
  let handle: PlayerHandle | null = null;
  let token = 0; // generation: bumped on every (re)play; deferred work checks it before acting
  let pendingFailover = false; // coalesces concurrent auto-failover triggers into one advance
  let errStreak = 0;
  let usedNetRecovery = false;
  let usedMediaRecovery = false;
  let firstFrame = false;
  let playStartTs = 0;
  let lastTime = 0;
  let frozenTicks = 0;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  let connectTimer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;

  const clearTimers = (): void => {
    if (watchdog !== undefined) clearInterval(watchdog);
    if (recoveryTimer !== undefined) clearTimeout(recoveryTimer);
    if (connectTimer !== undefined) clearTimeout(connectTimer);
    watchdog = recoveryTimer = connectTimer = undefined;
  };

  const healthy = (my: number): void => {
    if (my !== token) return; // a fragment from a superseded source
    errStreak = 0;
    frozenTicks = 0;
    firstFrame = true;
    if (recoveryTimer !== undefined) clearTimeout(recoveryTimer);
    if (connectTimer !== undefined) clearTimeout(connectTimer);
    recoveryTimer = connectTimer = undefined;
  };

  function onError(data: { fatal?: boolean; type?: string; details?: string }, my: number): void {
    if (my !== token || destroyed) return;
    const action = classifyError(data);
    if (action === 'ignore') return;
    if (action === 'degrade') {
      if (++errStreak >= T.degradedStreak) triggerFailover('Stream degraded');
      return;
    }
    const hls = handle?.hls;
    if (action === 'recover-network' && hls && !usedNetRecovery) {
      usedNetRecovery = true;
      hls.startLoad();
      armRecoveryDeadline(my);
    } else if (action === 'recover-media' && hls && !usedMediaRecovery) {
      usedMediaRecovery = true;
      hls.recoverMediaError();
      armRecoveryDeadline(my);
    } else {
      triggerFailover(`Fatal error (${data.details ?? data.type ?? 'unknown'})`);
    }
  }

  function armRecoveryDeadline(my: number): void {
    if (recoveryTimer !== undefined) clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(() => {
      if (my === token && !destroyed) triggerFailover('Source unrecoverable');
    }, T.recoveryMs);
  }

  function armConnectDeadline(my: number): void {
    connectTimer = setTimeout(() => {
      if (my === token && !destroyed && !firstFrame) triggerFailover('Source did not start');
    }, T.connectMs);
  }

  /** Coalesced auto-advance: many triggers on the same source collapse into one step. */
  function triggerFailover(reason: string): void {
    if (destroyed || pendingFailover) return;
    pendingFailover = true;
    void play(index + 1, reason);
  }

  function startWatchdog(my: number): void {
    lastTime = 0;
    frozenTicks = 0;
    watchdog = setInterval(() => {
      if (my !== token || destroyed) return;
      if (recoveryTimer !== undefined) return; // don't fight an in-progress recovery
      if (video.paused || video.readyState < 2) return;
      if (video.currentTime <= lastTime + 0.05) {
        if (++frozenTicks >= T.maxFrozenTicks && Date.now() - playStartTs > T.minPlayMs) {
          triggerFailover('Playback stalled');
        }
      } else {
        frozenTicks = 0;
      }
      lastTime = video.currentTime;
    }, T.watchdogMs);
  }

  async function play(i: number, reason = ''): Promise<void> {
    const my = ++token;
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

    // Install this mirror's headers before any request. A failed prep must not leave us wedged
    // on a torn-down handle (the old one is already destroyed) — advance instead.
    try {
      await hooks.prepareMirror(i);
    } catch {
      if (my === token && !destroyed) void play(i + 1, 'Could not prepare source');
      return;
    }
    if (my !== token || destroyed) return; // superseded while awaiting

    pendingFailover = false; // this source is now the active one; future failovers may fire
    errStreak = 0;
    frozenTicks = 0;
    usedNetRecovery = false;
    usedMediaRecovery = false;
    firstFrame = false;
    playStartTs = Date.now();
    try {
      handle = createPlayer(video, stream.manifestUrl, {
        forceLive: true,
        onFragLoaded: () => healthy(my),
        onError: (d) => onError(d, my),
      });
      startWatchdog(my);
      armConnectDeadline(my);
    } catch (e) {
      if (my === token && !destroyed) void play(i + 1, (e as Error).message);
    }
  }

  void play(0);

  return {
    select(i: number): void {
      if (destroyed || i < 0 || i >= streams.length || i === index) return;
      pendingFailover = false; // a manual pick overrides any coalesced auto-failover
      void play(i);
    },
    destroy(): void {
      destroyed = true;
      token++; // invalidate every in-flight play() and deferred callback
      clearTimers();
      handle?.destroy();
      handle = null;
    },
  };
}
