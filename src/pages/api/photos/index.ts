import type { APIRoute } from 'astro';
import { json } from '../../../lib/json';
import { getStore, type NewPhotoMeta } from '../../../lib/store';
import { sanitizeTags } from '../../../lib/tags';

export const prerender = false;

const MAX_FILE_BYTES = 40 * 1024 * 1024;

export const GET: APIRoute = async () => {
  const store = getStore();
  return json({ photos: await store.listPhotos() });
};

/**
 * Multipart upload: `meta` (JSON string), `full` (File), `thumb` (File).
 * Images arrive already resized by the admin client.
 */
export const POST: APIRoute = async ({ request }) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'expected multipart form data' }, 400);
  }

  const metaRaw = form.get('meta');
  const full = form.get('full');
  const thumb = form.get('thumb');
  if (typeof metaRaw !== 'string' || !(full instanceof File) || !(thumb instanceof File)) {
    return json({ error: 'missing meta, full or thumb' }, 400);
  }
  if (full.size > MAX_FILE_BYTES || thumb.size > MAX_FILE_BYTES) {
    return json({ error: 'file too large' }, 413);
  }

  let meta: NewPhotoMeta;
  try {
    meta = JSON.parse(metaRaw) as NewPhotoMeta;
  } catch {
    return json({ error: 'invalid meta json' }, 400);
  }
  if (!Number.isFinite(meta.width) || !Number.isFinite(meta.height)) {
    return json({ error: 'meta must include width and height' }, 400);
  }

  const store = getStore();
  const photo = await store.createPhoto(
    {
      width: Math.round(meta.width),
      height: Math.round(meta.height),
      caption: typeof meta.caption === 'string' ? meta.caption : '',
      tags: sanitizeTags(meta.tags),
      albumId: typeof meta.albumId === 'string' ? meta.albumId : null,
      published: meta.published === true,
      color: typeof meta.color === 'string' ? meta.color.slice(0, 16) : undefined,
      takenAt: typeof meta.takenAt === 'string' ? meta.takenAt : null,
    },
    { data: new Uint8Array(await full.arrayBuffer()), type: full.type || 'image/jpeg' },
    { data: new Uint8Array(await thumb.arrayBuffer()), type: thumb.type || 'image/jpeg' }
  );
  return json({ photo }, 201);
};
