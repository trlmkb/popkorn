import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import vercel from '@astrojs/vercel';

// On Vercel (which sets VERCEL=1 at build time) use its serverless adapter;
// everywhere else (local dev, Docker, Fly.io, Railway) use the Node server.
export default defineConfig({
  output: 'server',
  adapter: process.env.VERCEL ? vercel() : node({ mode: 'standalone' }),
});
