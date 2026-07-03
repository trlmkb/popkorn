import type { NewPhotoMeta } from '../../lib/store/types';

export interface ProcessedImage {
  meta: NewPhotoMeta;
  full: Blob;
  thumb: Blob;
}

const FULL_MAX = 2560;
const THUMB_MAX = 640;

let webpSupport: Promise<boolean> | null = null;

function canEncodeWebp(): Promise<boolean> {
  if (!webpSupport) {
    webpSupport = new Promise((resolve) => {
      const c = document.createElement('canvas');
      c.width = c.height = 2;
      c.toBlob((b) => resolve(b?.type === 'image/webp'), 'image/webp', 0.8);
    });
  }
  return webpSupport;
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Fallback for formats createImageBitmap can't handle (e.g. HEIC on Safari).
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
  }
}

function dimensions(src: ImageBitmap | HTMLImageElement): { w: number; h: number } {
  return src instanceof HTMLImageElement
    ? { w: src.naturalWidth, h: src.naturalHeight }
    : { w: src.width, h: src.height };
}

async function encode(
  src: ImageBitmap | HTMLImageElement,
  maxEdge: number,
  quality: number
): Promise<{ blob: Blob; w: number; h: number; canvas: HTMLCanvasElement }> {
  const { w, h } = dimensions(src);
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, cw, ch);
  const type = (await canEncodeWebp()) ? 'image/webp' : 'image/jpeg';
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encoding failed'))), type, quality);
  });
  return { blob, w: cw, h: ch, canvas };
}

function averageColor(canvas: HTMLCanvasElement): string {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(canvas, 0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  // Darken slightly so placeholders sit well on the dark UI.
  const hex = (n: number) => Math.round(n * 0.85).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export async function processImage(file: File): Promise<ProcessedImage> {
  const src = await decode(file);
  const full = await encode(src, FULL_MAX, 0.84);
  const thumb = await encode(src, THUMB_MAX, 0.75);
  if (src instanceof ImageBitmap) src.close();
  return {
    meta: {
      width: full.w,
      height: full.h,
      color: averageColor(thumb.canvas),
      takenAt: file.lastModified ? new Date(file.lastModified).toISOString() : null,
    },
    full: full.blob,
    thumb: thumb.blob,
  };
}
