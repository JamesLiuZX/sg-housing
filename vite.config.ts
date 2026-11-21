import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';

const single = !!process.env.SINGLE;

export default defineConfig({
  base: process.env.BASE_PATH ?? './',
  plugins: [svelte(), ...(single ? [viteSingleFile()] : [])],
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  // Agent worktrees under .claude are separate checkouts with their own tests.
  test: { exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**'] },
  server: { watch: { ignored: ['**/.claude/**'] } }
});
