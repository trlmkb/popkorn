import {
  type Album,
  type AlbumPatch,
  type ImageFile,
  type NewPhotoMeta,
  type Photo,
  type PhotoPatch,
  type Store,
  extFor,
  newId,
} from './types';

const BUCKET = 'photos';

interface PhotoRow {
  id: string;
  full_path: string;
  thumb_path: string;
  width: number;
  height: number;
  caption: string;
  tags: string[];
  album_id: string | null;
  published: boolean;
  color: string;
  taken_at: string | null;
  created_at: string;
}

interface AlbumRow {
  id: string;
  title: string;
  cover_id: string | null;
  created_at: string;
}

/**
 * Driver for serverless hosts (Vercel, Netlify, …): metadata in Supabase
 * Postgres via PostgREST, images in a public Supabase Storage bucket.
 * Activated when SUPABASE_URL + SUPABASE_SERVICE_KEY are set.
 */
export class SupabaseStore implements Store {
  constructor(
    private url: string,
    private key: string
  ) {
    this.url = url.replace(/\/$/, '');
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      ...extra,
    };
  }

  private async rest<T>(method: string, pathAndQuery: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.url}/rest/v1/${pathAndQuery}`, {
      method,
      headers: this.headers({
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Supabase ${method} ${pathAndQuery}: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as T;
  }

  private async putObject(objectPath: string, file: ImageFile): Promise<void> {
    const res = await fetch(`${this.url}/storage/v1/object/${BUCKET}/${objectPath}`, {
      method: 'POST',
      headers: this.headers({
        'Content-Type': file.type,
        'x-upsert': 'true',
        'Cache-Control': 'max-age=31536000',
      }),
      body: file.data as unknown as BodyInit,
    });
    if (!res.ok) {
      throw new Error(`Supabase upload ${objectPath}: ${res.status} ${await res.text()}`);
    }
  }

  private async removeObjects(paths: string[]): Promise<void> {
    await fetch(`${this.url}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefixes: paths }),
    }).catch(() => {});
  }

  private publicUrl(objectPath: string): string {
    return `${this.url}/storage/v1/object/public/${BUCKET}/${objectPath}`;
  }

  private toPhoto(row: PhotoRow): Photo {
    return {
      id: row.id,
      full: this.publicUrl(row.full_path),
      thumb: this.publicUrl(row.thumb_path),
      width: row.width,
      height: row.height,
      caption: row.caption,
      tags: row.tags ?? [],
      albumId: row.album_id,
      published: row.published,
      color: row.color,
      takenAt: row.taken_at,
      createdAt: row.created_at,
    };
  }

  private toAlbum(row: AlbumRow): Album {
    return { id: row.id, title: row.title, coverId: row.cover_id, createdAt: row.created_at };
  }

  async listPhotos(): Promise<Photo[]> {
    const rows = await this.rest<PhotoRow[]>('GET', 'photos?select=*');
    return rows
      .map((r) => this.toPhoto(r))
      .sort((a, b) => (b.takenAt || b.createdAt).localeCompare(a.takenAt || a.createdAt));
  }

  async getPhoto(id: string): Promise<Photo | null> {
    const rows = await this.rest<PhotoRow[]>('GET', `photos?id=eq.${encodeURIComponent(id)}&select=*`);
    return rows[0] ? this.toPhoto(rows[0]) : null;
  }

  async createPhoto(meta: NewPhotoMeta, full: ImageFile, thumb: ImageFile): Promise<Photo> {
    const id = newId();
    const fullPath = `${id}.${extFor(full.type)}`;
    const thumbPath = `${id}.thumb.${extFor(thumb.type)}`;
    await this.putObject(fullPath, full);
    await this.putObject(thumbPath, thumb);
    const rows = await this.rest<PhotoRow[]>('POST', 'photos', {
      id,
      full_path: fullPath,
      thumb_path: thumbPath,
      width: meta.width,
      height: meta.height,
      caption: meta.caption ?? '',
      tags: meta.tags ?? [],
      album_id: meta.albumId ?? null,
      published: meta.published ?? false,
      color: meta.color ?? '#1a1a1a',
      taken_at: meta.takenAt ?? null,
    });
    return this.toPhoto(rows[0]);
  }

  async updatePhoto(id: string, patch: PhotoPatch): Promise<Photo | null> {
    const body: Partial<PhotoRow> = {};
    if (patch.caption !== undefined) body.caption = patch.caption;
    if (patch.tags !== undefined) body.tags = patch.tags;
    if (patch.albumId !== undefined) body.album_id = patch.albumId;
    if (patch.published !== undefined) body.published = patch.published;
    if (patch.takenAt !== undefined) body.taken_at = patch.takenAt;
    const rows = await this.rest<PhotoRow[]>(
      'PATCH',
      `photos?id=eq.${encodeURIComponent(id)}`,
      body
    );
    return rows[0] ? this.toPhoto(rows[0]) : null;
  }

  async deletePhoto(id: string): Promise<boolean> {
    const rows = await this.rest<PhotoRow[]>('DELETE', `photos?id=eq.${encodeURIComponent(id)}`);
    if (!rows[0]) return false;
    await this.rest<AlbumRow[]>('PATCH', `albums?cover_id=eq.${encodeURIComponent(id)}`, {
      cover_id: null,
    }).catch(() => {});
    await this.removeObjects([rows[0].full_path, rows[0].thumb_path]);
    return true;
  }

  async listAlbums(): Promise<Album[]> {
    const rows = await this.rest<AlbumRow[]>('GET', 'albums?select=*&order=created_at.asc');
    return rows.map((r) => this.toAlbum(r));
  }

  async createAlbum(title: string): Promise<Album> {
    const rows = await this.rest<AlbumRow[]>('POST', 'albums', { id: newId(), title });
    return this.toAlbum(rows[0]);
  }

  async updateAlbum(id: string, patch: AlbumPatch): Promise<Album | null> {
    const body: Partial<AlbumRow> = {};
    if (patch.title !== undefined) body.title = patch.title;
    if (patch.coverId !== undefined) body.cover_id = patch.coverId;
    const rows = await this.rest<AlbumRow[]>(
      'PATCH',
      `albums?id=eq.${encodeURIComponent(id)}`,
      body
    );
    return rows[0] ? this.toAlbum(rows[0]) : null;
  }

  async deleteAlbum(id: string): Promise<boolean> {
    await this.rest<PhotoRow[]>('PATCH', `photos?album_id=eq.${encodeURIComponent(id)}`, {
      album_id: null,
    });
    const rows = await this.rest<AlbumRow[]>('DELETE', `albums?id=eq.${encodeURIComponent(id)}`);
    return rows.length > 0;
  }
}
