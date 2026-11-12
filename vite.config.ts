import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';

const single = !!process.env.SINGLE;

export default defineConfig({
  base: process.env.BASE_PATH ?? './',
  plugins: [svelte(), ...(single ? [viteSingleFile()] : [])],
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 }
});
