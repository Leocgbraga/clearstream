// Shared types. Kept free of chrome/DOM imports so core logic stays unit-testable.
// See docs/research/06-capture-engine.md (§2 keying) and docs/architecture.md (§5.2).

export type ManifestKind = 'master' | 'media' | 'unknown';

/** Request headers we capture and replay (Origin/Sec-Fetch-* are unforgeable — omitted). */
export interface ReplayHeaders {
  referer?: string;
  origin?: string;
  cookie?: string;
  userAgent?: string;
}

/** A stream detected on a tab, plus everything needed to replay it cleanly. */
export interface CapturedStream {
  /** Durable key = canonical manifest URL (host+path, cache-busters stripped). */
  key: string;
  manifestUrl: string;
  tabId: number;
  frameId: number;
  pageUrl: string;
  replayHeaders: ReplayHeaders;
  /** Host of the first segment seen after this manifest (segments may differ from manifest host). */
  segmentOrigin?: string;
  kind?: ManifestKind;
  /** Ranking score for auto-pick (master > media > ad-stub). */
  score?: number;
  /** Which capture layer first saw this stream — surfaced by debug builds. */
  source?: 'scan' | 'passive' | 'deep';
  createdAt: number;
}
