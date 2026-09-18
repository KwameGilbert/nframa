import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Resolves the path aliases declared in tsconfig.json, including the
    // ones added by `nest g library` — vitest's native equivalent of the
    // vite-tsconfig-paths plugin.
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
  },
});
