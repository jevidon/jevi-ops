import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Component tests for the web app (jsdom). The API's integration suite
// lives in apps/api; this covers behaviour only a browser environment can
// exercise — editor state during an in-flight save, navigation guards.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
  esbuild: { jsx: 'automatic' },
  // Mirror tsconfig's `@/*` → `src/*` so components that import server
  // actions by alias can be rendered with those actions mocked.
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
});
