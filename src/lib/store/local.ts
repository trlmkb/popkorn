import fs from 'node:fs/promises';
import path from 'node:path';
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

export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

interface Db {
  photos: Photo[];
  albums: Album[];
}

/**
 * Zero-config driver: metadata in a JSON file, images on disk.
 * Right-sized for a personal photobook; deploy anywhere with a volume.
 */
export class LocalStore implements Store {
  private db: Db | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  /** Serialize all mutations so concurrent requests can't clobber db.json. */
  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  private async load(): Promise<Db> {
    if (this.db) return this.db;
    try {
      this.db = JSON.parse(await fs.readFile(DB_FILE, 'utf8')) as Db;
    } catch {
      this.db = { photos: [], albums: [] };
    }
    return this.db;
  }

  private async persist(): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(this.db, null, 2));
    await fs.rename(tmp, DB_FILE);
  }

  async listPhotos(): Promise<Photo[]> {
    const db = await this.load();
    return [...db.photos].sort((a, b) =>
      (b.takenAt || b.createdAt).localeCompare(a.takenAt || a.createdAt)
    );
  }

  async getPhoto(id: string): Promise<Photo | null> {
    const db = await this.load();
    return db.photos.find((p) => p.id === id) ?? null;
  }

  async createPhoto(meta: NewPhotoMeta, full: ImageFile, thumb: ImageFile): Promise<Photo> {
    return this.locked(async () => {
      const db = await this.load();
      const id = newId();
      await fs.mkdir(UPLOADS_DIR, { recursive: true });
      const fullName = `${id}.${extFor(full.type)}`;
      const thumbName = `${id}.thumb.${extFor(thumb.type)}`;
      await fs.writeFile(path.join(UPLOADS_DIR, fullName), full.data);
      await fs.writeFile(path.join(UPLOADS_DIR, thumbName), thumb.data);
      const photo: Photo = {
        id,
        full: `/uploads/${fullName}`,
        thumb: `/uploads/${thumbName}`,
        width: meta.width,
        height: meta.height,
        caption: meta.caption ?? '',
        tags: meta.tags ?? [],
        albumId: meta.albumId ?? null,
        published: meta.published ?? false,
        color: meta.color ?? '#1a1a1a',
        takenAt: meta.takenAt ?? null,
        createdAt: new Date().toISOString(),
      };
      db.photos.push(photo);
      await this.persist();
      return photo;
    });
  }

  async updatePhoto(id: string, patch: PhotoPatch): Promise<Photo | null> {
    return this.locked(async () => {
      const db = await this.load();
      const photo = db.photos.find((p) => p.id === id);
      if (!photo) return null;
      Object.assign(photo, patch);
      await this.persist();
      return photo;
    });
  }

  async deletePhoto(id: string): Promise<boolean> {
    return this.locked(async () => {
      const db = await this.load();
      const i = db.photos.findIndex((p) => p.id === id);
      if (i === -1) return false;
      const [photo] = db.photos.splice(i, 1);
      for (const album of db.albums) {
        if (album.coverId === id) album.coverId = null;
      }
      await this.persist();
      for (const url of [photo.full, photo.thumb]) {
        const file = path.join(UPLOADS_DIR, path.basename(url));
        await fs.unlink(file).catch(() => {});
      }
      return true;
    });
  }

  async listAlbums(): Promise<Album[]> {
    const db = await this.load();
    return [...db.albums].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createAlbum(title: string): Promise<Album> {
    return this.locked(async () => {
      const db = await this.load();
      const album: Album = {
        id: newId(),
        title,
        coverId: null,
        createdAt: new Date().toISOString(),
      };
      db.albums.push(album);
      await this.persist();
      return album;
    });
  }

  async updateAlbum(id: string, patch: AlbumPatch): Promise<Album | null> {
    return this.locked(async () => {
      const db = await this.load();
      const album = db.albums.find((a) => a.id === id);
      if (!album) return null;
      Object.assign(album, patch);
      await this.persist();
      return album;
    });
  }

  async deleteAlbum(id: string): Promise<boolean> {
    return this.locked(async () => {
      const db = await this.load();
      const i = db.albums.findIndex((a) => a.id === id);
      if (i === -1) return false;
      db.albums.splice(i, 1);
      for (const photo of db.photos) {
        if (photo.albumId === id) photo.albumId = null;
      }
      await this.persist();
      return true;
    });
  }
}
