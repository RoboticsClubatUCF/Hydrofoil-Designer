import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Relative base so the built site works from any path (GitHub Pages project page, a fork, or a local file server).
export default defineConfig({
  base: './',
  plugins: [react()],
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 900 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
