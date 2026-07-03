import type { APIRoute } from 'astro';
import { json } from '../../../lib/json';
import { getStore, type AlbumPatch } from '../../../lib/store';

export const prerender = false;

export const PATCH: APIRoute = async ({ params, request }) => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const patch: AlbumPatch = {};
  if (typeof body.title === 'string' && body.title.trim()) {
    patch.title = body.title.trim().slice(0, 120);
  }
  if (body.coverId === null || typeof body.coverId === 'string') {
    patch.coverId = body.coverId as string | null;
  }
  const album = await getStore().updateAlbum(params.id!, patch);
  if (!album) return json({ error: 'not found' }, 404);
  return json({ album });
};

export const DELETE: APIRoute = async ({ params }) => {
  const ok = await getStore().deleteAlbum(params.id!);
  if (!ok) return json({ error: 'not found' }, 404);
  return json({ ok: true });
};
