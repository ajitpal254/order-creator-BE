import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Each test file gets its own worker to avoid shared state between suites
    pool: 'forks',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.js'],
      exclude: ['src/seed/**', 'src/assets/**'],
    },
    // All tests live in /tests
    include: ['tests/**/*.test.js'],
  },
});
