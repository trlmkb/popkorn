import type { APIRoute } from 'astro';
import { json } from '../../../lib/json';
import { getStore } from '../../../lib/store';

export const prerender = false;

export const GET: APIRoute = async () => {
  return json({ albums: await getStore().listAlbums() });
};

export const POST: APIRoute = async ({ request }) => {
  let title = '';
  try {
    const body = (await request.json()) as { title?: string };
    title = (body.title ?? '').trim().slice(0, 120);
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  if (!title) return json({ error: 'title required' }, 400);
  const album = await getStore().createAlbum(title);
  return json({ album }, 201);
};
