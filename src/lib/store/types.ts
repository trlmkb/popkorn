export interface Photo {
  id: string;
  /** Public URL of the display-size image */
  full: string;
  /** Public URL of the thumbnail */
  thumb: string;
  width: number;
  height: number;
  caption: string;
  tags: string[];
  albumId: string | null;
  published: boolean;
  /** Dominant color, used as a placeholder while the image loads */
  color: string;
  takenAt: string | null;
  createdAt: string;
}

export interface Album {
  id: string;
  title: string;
  coverId: string | null;
  createdAt: string;
}

export interface NewPhotoMeta {
  width: number;
  height: number;
  caption?: string;
  tags?: string[];
  albumId?: string | null;
  published?: boolean;
  color?: string;
  takenAt?: string | null;
}

export type PhotoPatch = Partial<
  Pick<Photo, 'caption' | 'tags' | 'albumId' | 'published' | 'takenAt'>
>;

export type AlbumPatch = Partial<Pick<Album, 'title' | 'coverId'>>;

export interface ImageFile {
  data: Uint8Array;
  /** e.g. image/webp or image/jpeg */
  type: string;
}

export interface Store {
  listPhotos(): Promise<Photo[]>;
  getPhoto(id: string): Promise<Photo | null>;
  createPhoto(meta: NewPhotoMeta, full: ImageFile, thumb: ImageFile): Promise<Photo>;
  updatePhoto(id: string, patch: PhotoPatch): Promise<Photo | null>;
  deletePhoto(id: string): Promise<boolean>;

  listAlbums(): Promise<Album[]>;
  createAlbum(title: string): Promise<Album>;
  updateAlbum(id: string, patch: AlbumPatch): Promise<Album | null>;
  deleteAlbum(id: string): Promise<boolean>;
}

export function newId(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  );
}

export function extFor(type: string): string {
  if (type === 'image/webp') return 'webp';
  if (type === 'image/png') return 'png';
  if (type === 'image/avif') return 'avif';
  return 'jpg';
}
