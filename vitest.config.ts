import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Unit tests cover the pure core (detection/dedupe/ranking, the live-ify heuristic, header merge).
// '@' mirrors WXT's srcDir alias so tests import the same paths the extension does.
export default defineConfig({
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
