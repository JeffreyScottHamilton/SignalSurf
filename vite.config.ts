import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Resolve the `@/` alias from this file's location without pulling in Node typings.
const srcDir = decodeURIComponent(new URL('./src', import.meta.url).pathname);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': srcDir },
  },
  test: {
    environment: 'jsdom',
  },
});
