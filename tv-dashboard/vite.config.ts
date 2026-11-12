import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: { fs: { allow: ['..'] } }, // @lmclub/contracts lives in the monorepo root
  build: { target: 'es2022', sourcemap: true },
  test: { environment: 'node' },
});
