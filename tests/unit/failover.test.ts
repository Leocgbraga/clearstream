import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createFailoverController,
  classifyError,
  DEFAULT_TUNABLES as D,
} from '@/core/player/failover';
import type { CapturedStream } from '@/core/types';

const mk = (url: string): CapturedStream => ({
  key: url,
  manifestUrl: url,
  tabId: 1,
  frameId: 0,
  pageUrl: '',
  replayHeaders: {},
  createdAt: 0,
});

type FakeVideo = { currentTime: number; paused: boolean; readyState: number };
const makeVideo = (over: Partial<FakeVideo> = {}): FakeVideo => ({
  currentTime: 0,
  paused: false,
  readyState: 3,
  ...over,
});

interface FakeInstance {
  src: string;
  opts: { onError?: (d: unknown) => void; onFragLoaded?: () => void };
  hls: { startLoad: ReturnType<typeof vi.fn>; recoverMediaError: ReturnType<typeof vi.fn> };
  destroyed: boolean;
}

function playerFactory() {
  const instances: FakeInstance[] = [];
  const createPlayer = (_v: unknown, src: string, opts: FakeInstance['opts']) => {
    const hls = { startLoad: vi.fn(), recoverMediaError: vi.fn() };
    const inst: FakeInstance = { src, opts, hls, destroyed: false };
    instances.push(inst);
    return {
      hls,
      destroy() {
        inst.destroyed = true;
      },
    };
  };
  return { createPlayer: createPlayer as never, instances, last: () => instances[instances.length - 1]! };
}

// Let parked `await prepareMirror` continuations run (fake timers don't touch the microtask queue).
const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

describe('classifyError', () => {
  it('treats network / buffer-stall / frag load+parse as degradations', () => {
    expect(classifyError({ fatal: false, type: 'networkError' })).toBe('degrade');
    expect(classifyError({ fatal: false, details: 'bufferStalledError' })).toBe('degrade');
    expect(classifyError({ fatal: false, details: 'fragLoadError' })).toBe('degrade');
    expect(classifyError({ fatal: false, details: 'fragLoadTimeOut' })).toBe('degrade');
    expect(classifyError({ fatal: false, details: 'fragParsingError' })).toBe('degrade');
  });
  it('ignores benign non-fatals (e.g. fragGap) — the old .includes("rag") wrongly counted these', () => {
    expect(classifyError({ fatal: false, details: 'fragGap' })).toBe('ignore');
    expect(classifyError({ fatal: false, details: 'audioTrackLoadError' })).toBe('ignore');
  });
  it('routes fatal errors to the right recovery, else fatal', () => {
    expect(classifyError({ fatal: true, type: 'networkError', details: 'manifestLoadError' })).toBe('recover-network');
    expect(classifyError({ fatal: true, type: 'mediaError', details: 'bufferAppendError' })).toBe('recover-media');
    expect(classifyError({ fatal: true, type: 'otherError', details: 'levelSwitchError' })).toBe('fatal');
  });
});

describe('createFailoverController', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('plays the first source on start', async () => {
    const f = playerFactory();
    const c = createFailoverController(makeVideo() as never, [mk('a'), mk('b')], { prepareMirror: async () => {}, onStatus: vi.fn() }, { createPlayer: f.createPlayer });
    await flush();
    expect(f.instances).toHaveLength(1);
    expect(f.last().src).toBe('a');
    c.destroy();
  });

  it('a fatal network error recovers once, then fails over when the deadline passes with no fragment', async () => {
    const f = playerFactory();
    const c = createFailoverController(makeVideo() as never, [mk('a'), mk('b')], { prepareMirror: async () => {}, onStatus: vi.fn() }, { createPlayer: f.createPlayer });
    await flush();
    f.instances[0]!.opts.onError!({ fatal: true, type: 'networkError', details: 'manifestLoadError' });
    expect(f.instances[0]!.hls.startLoad).toHaveBeenCalledTimes(1); // in-place recovery first
    expect(f.instances).toHaveLength(1); // not advanced yet
    vi.advanceTimersByTime(D.recoveryMs + 10);
    await flush();
    expect(f.instances).toHaveLength(2);
    expect(f.last().src).toBe('b');
    c.destroy();
  });

  it('advances after a streak of non-fatal degradations', async () => {
    const f = playerFactory();
    const c = createFailoverController(makeVideo() as never, [mk('a'), mk('b')], { prepareMirror: async () => {}, onStatus: vi.fn() }, { createPlayer: f.createPlayer });
    await flush();
    for (let i = 0; i < D.degradedStreak; i++) f.instances[0]!.opts.onError!({ fatal: false, type: 'networkError' });
    await flush();
    expect(f.last().src).toBe('b');
    c.destroy();
  });

  it('does NOT double-advance when errors keep arriving on an already-superseded source', async () => {
    const f = playerFactory();
    let release!: () => void;
    const prepareMirror = (i: number): Promise<void> =>
      i === 1 ? new Promise<void>((r) => (release = r)) : Promise.resolve();
    const c = createFailoverController(makeVideo() as never, [mk('a'), mk('b'), mk('c')], { prepareMirror, onStatus: vi.fn() }, { createPlayer: f.createPlayer });
    await flush();
    const i0 = f.instances[0]!;
    i0.opts.onError!({ fatal: true, type: 'otherError', details: 'keyLoadError' }); // → play(1), parked on prepareMirror
    i0.opts.onError!({ fatal: true, type: 'otherError', details: 'keyLoadError' }); // stale source → must be ignored
    release();
    await flush();
    expect(f.instances).toHaveLength(2); // a, b — NOT c
    expect(f.last().src).toBe('b');
    c.destroy();
  });

  it('connect-timeout advances a source stuck at readyState<2 (watchdog can\'t see it)', async () => {
    const f = playerFactory();
    const v = makeVideo({ readyState: 1 }); // metadata only, never a decodable frame
    const c = createFailoverController(v as never, [mk('a'), mk('b')], { prepareMirror: async () => {}, onStatus: vi.fn() }, { createPlayer: f.createPlayer });
    await flush();
    vi.advanceTimersByTime(D.connectMs + 10);
    await flush();
    expect(f.instances).toHaveLength(2);
    expect(f.last().src).toBe('b');
    c.destroy();
  });

  it('anti-flap: a frozen-but-playing source is not failed over before minPlayMs', async () => {
    const f = playerFactory();
    const c = createFailoverController(makeVideo({ readyState: 3 }) as never, [mk('a'), mk('b')], { prepareMirror: async () => {}, onStatus: vi.fn() }, { createPlayer: f.createPlayer });
    await flush();
    vi.advanceTimersByTime(D.minPlayMs - 100); // currentTime never advances, but under the floor
    await flush();
    expect(f.instances).toHaveLength(1);
    c.destroy();
  });

  it('a healthy fragment resets the degradation streak', async () => {
    const f = playerFactory();
    const c = createFailoverController(makeVideo() as never, [mk('a'), mk('b')], { prepareMirror: async () => {}, onStatus: vi.fn() }, { createPlayer: f.createPlayer });
    await flush();
    const i0 = f.instances[0]!;
    for (let i = 0; i < D.degradedStreak - 1; i++) i0.opts.onError!({ fatal: false, type: 'networkError' });
    i0.opts.onFragLoaded!(); // healthy → reset
    for (let i = 0; i < D.degradedStreak - 1; i++) i0.opts.onError!({ fatal: false, type: 'networkError' });
    await flush();
    expect(f.instances).toHaveLength(1); // never hit the streak threshold again
    c.destroy();
  });

  it('select() pins a source and tears down the previous one', async () => {
    const f = playerFactory();
    const c = createFailoverController(makeVideo() as never, [mk('a'), mk('b'), mk('c')], { prepareMirror: async () => {}, onStatus: vi.fn() }, { createPlayer: f.createPlayer });
    await flush();
    c.select(2);
    await flush();
    expect(f.last().src).toBe('c');
    expect(f.instances[0]!.destroyed).toBe(true);
    c.destroy();
  });

  it('a prepareMirror rejection advances instead of wedging', async () => {
    const f = playerFactory();
    const prepareMirror = (i: number): Promise<void> => (i === 0 ? Promise.reject(new Error('prep failed')) : Promise.resolve());
    const c = createFailoverController(makeVideo() as never, [mk('a'), mk('b')], { prepareMirror, onStatus: vi.fn() }, { createPlayer: f.createPlayer });
    await flush();
    expect(f.instances).toHaveLength(1); // source 0 never created a player; advanced to 1
    expect(f.last().src).toBe('b');
    c.destroy();
  });

  it('destroy() stops all timers and prevents further failover', async () => {
    const f = playerFactory();
    const c = createFailoverController(makeVideo() as never, [mk('a'), mk('b')], { prepareMirror: async () => {}, onStatus: vi.fn() }, { createPlayer: f.createPlayer });
    await flush();
    const i0 = f.instances[0]!;
    c.destroy();
    expect(i0.destroyed).toBe(true);
    i0.opts.onError!({ fatal: true, type: 'networkError' });
    vi.advanceTimersByTime(60000);
    await flush();
    expect(f.instances).toHaveLength(1); // nothing new after destroy
  });

  it('reports "All sources failed" after exhausting the list', async () => {
    const f = playerFactory();
    const onStatus = vi.fn();
    const c = createFailoverController(makeVideo() as never, [mk('a')], { prepareMirror: async () => {}, onStatus }, { createPlayer: f.createPlayer });
    await flush();
    f.instances[0]!.opts.onError!({ fatal: true, type: 'otherError', details: 'x' }); // → play(1) which is out of range
    await flush();
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ failed: true }));
    c.destroy();
  });
});
