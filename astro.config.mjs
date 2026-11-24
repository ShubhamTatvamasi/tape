import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';

// Deployed as a GitHub Pages project site at
// https://shubhamtatvamasi.com/tape/
//
// The deploy workflow sets BASE_PATH to "/<repo name>" so the same build works
// no matter what the repository is called.
const base = process.env.BASE_PATH ?? '/tape';

export default defineConfig({
  site: 'https://shubhamtatvamasi.com',
  base,
  trailingSlash: 'ignore',
  compressHTML: true,
  integrations: [svelte()],
  build: {
    inlineStylesheets: 'auto',
  },
  vite: {
    server: {
      fs: { strict: true },
    },
  },
});
