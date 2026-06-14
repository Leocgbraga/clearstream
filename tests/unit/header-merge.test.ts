import { describe, it, expect } from 'vitest';
import { upsertHeader, type WebRequestHeader } from '@/core/header-injector/merge';

describe('upsertHeader', () => {
  it('appends a header that is not present', () => {
    const h: WebRequestHeader[] = [];
    upsertHeader(h, 'Referer', 'https://x/');
    expect(h).toEqual([{ name: 'Referer', value: 'https://x/' }]);
  });
  it('overwrites an existing header case-insensitively (no duplicate)', () => {
    const h: WebRequestHeader[] = [{ name: 'referer', value: 'old' }];
    upsertHeader(h, 'Referer', 'new');
    expect(h).toEqual([{ name: 'referer', value: 'new' }]);
  });
  it('is a no-op for empty or undefined values', () => {
    const h: WebRequestHeader[] = [{ name: 'X', value: 'keep' }];
    upsertHeader(h, 'Referer', undefined);
    upsertHeader(h, 'Cookie', '');
    expect(h).toEqual([{ name: 'X', value: 'keep' }]);
  });
  it('preserves unrelated headers when appending', () => {
    const h: WebRequestHeader[] = [{ name: 'User-Agent', value: 'UA' }];
    upsertHeader(h, 'Referer', 'https://x/');
    expect(h).toHaveLength(2);
    expect(h.find((x) => x.name === 'User-Agent')?.value).toBe('UA');
  });
});
