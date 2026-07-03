import type { APIRoute } from 'astro';
import { json } from '../../../lib/json';
import { getStore, type PhotoPatch } from '../../../lib/store';
import { sanitizeTags } from '../../../lib/tags';

export const prerender = false;

export const PATCH: APIRoute = async ({ params, request }) => {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const patch: PhotoPatch = {};
  if (typeof body.caption === 'string') patch.caption = body.caption.slice(0, 2000);
  if (body.tags !== undefined) patch.tags = sanitizeTags(body.tags);
  if (body.albumId === null || typeof body.albumId === 'string') {
    patch.albumId = body.albumId as string | null;
  }
  if (typeof body.published === 'boolean') patch.published = body.published;
  if (body.takenAt === null || typeof body.takenAt === 'string') {
    patch.takenAt = body.takenAt as string | null;
  }

  const photo = await getStore().updatePhoto(params.id!, patch);
  if (!photo) return json({ error: 'not found' }, 404);
  return json({ photo });
};

export const DELETE: APIRoute = async ({ params }) => {
  const ok = await getStore().deletePhoto(params.id!);
  if (!ok) return json({ error: 'not found' }, 404);
  return json({ ok: true });
};
