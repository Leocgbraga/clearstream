// Build-time backend selection. `import.meta.env.FIREFOX` is a compile-time constant, so the
// unused backend is tree-shaken out of each browser's bundle.
import type { HeaderInjector } from './types';
import { DnrInjector } from './chrome';
import { WebRequestInjector } from './firefox';

export type { HeaderInjector } from './types';

export function createHeaderInjector(): HeaderInjector {
  if (import.meta.env.FIREFOX) return new WebRequestInjector();
  return new DnrInjector();
}
