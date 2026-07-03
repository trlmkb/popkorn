import type { Album, AlbumPatch, NewPhotoMeta, Photo, PhotoPatch } from '../../lib/store/types';

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    location.href = '/admin/login';
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(detail.error || `${method} ${url} failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export const api = {
  patchPhoto: (id: string, patch: PhotoPatch) =>
    req<{ photo: Photo }>('PATCH', `/api/photos/${id}`, patch).then((r) => r.photo),
  deletePhoto: (id: string) => req<{ ok: true }>('DELETE', `/api/photos/${id}`),
  createAlbum: (title: string) =>
    req<{ album: Album }>('POST', '/api/albums', { title }).then((r) => r.album),
  patchAlbum: (id: string, patch: AlbumPatch) =>
    req<{ album: Album }>('PATCH', `/api/albums/${id}`, patch).then((r) => r.album),
  deleteAlbum: (id: string) => req<{ ok: true }>('DELETE', `/api/albums/${id}`),
  logout: () => req<{ ok: true }>('DELETE', '/api/auth'),

  uploadPhoto(
    meta: NewPhotoMeta,
    full: Blob,
    thumb: Blob,
    onProgress: (fraction: number) => void
  ): Promise<Photo> {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('meta', JSON.stringify(meta));
      form.append('full', full, 'full');
      form.append('thumb', thumb, 'thumb');
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/photos');
      xhr.responseType = 'json';
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        if (xhr.status === 401) {
          location.href = '/admin/login';
          reject(new Error('unauthorized'));
        } else if (xhr.status >= 200 && xhr.status < 300) {
          resolve((xhr.response as { photo: Photo }).photo);
        } else {
          reject(new Error(xhr.response?.error || `upload failed (${xhr.status})`));
        }
      };
      xhr.onerror = () => reject(new Error('network error during upload'));
      xhr.send(form);
    });
  },
};
