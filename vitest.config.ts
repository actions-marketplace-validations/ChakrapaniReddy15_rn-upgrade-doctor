import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only this project's tests: fixtures/ and examples/ may contain sample apps with their own test files.
    include: ['test/**/*.test.ts'],
    // Several tests start the CLI as a separate process (Node + TypeScript compile), which can take seconds on a
    // shared CI machine; Vitest's defaults (5 s per test, 10 s per hook) are too tight for that.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
