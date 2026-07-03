import type { APIRoute } from 'astro';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '../../lib/store/local';

export const prerender = false;

const TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.avif': 'image/avif',
};

/** Serves images stored by the local driver. Unused with Supabase storage. */
export const GET: APIRoute = async ({ params }) => {
  const rel = params.path ?? '';
  const file = path.join(DATA_DIR, 'uploads', path.basename(rel));
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type) return new Response('Not found', { status: 404 });
  try {
    const data = await fs.readFile(file);
    return new Response(new Uint8Array(data), {
      headers: {
        'Content-Type': type,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
};
