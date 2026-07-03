import { Lightbox, type LightboxItem } from './lightbox';

interface BookPhoto extends LightboxItem {
  albumId: string | null;
}

const data = JSON.parse(document.getElementById('pk-data')!.textContent!) as {
  photos: BookPhoto[];
  albums: { id: string; title: string }[];
};

const grid = document.getElementById('grid')!;
const empty = document.getElementById('empty');
const cells = new Map<string, HTMLElement>();
for (const el of grid.querySelectorAll<HTMLElement>('.ph')) {
  cells.set(el.dataset.id!, el);
}

// ------------------------------------------------------------------ filters

let activeAlbum = '';
const activeTags = new Set<string>();

function matches(p: BookPhoto): boolean {
  if (activeAlbum && p.albumId !== activeAlbum) return false;
  if (activeTags.size > 0 && !p.tags.some((t) => activeTags.has(t))) return false;
  return true;
}

function applyFilters(): void {
  let visible = 0;
  for (const p of data.photos) {
    const el = cells.get(p.id);
    if (!el) continue;
    const show = matches(p);
    el.classList.toggle('is-hidden', !show);
    if (show) visible++;
  }
  if (empty) {
    empty.hidden = visible > 0;
    if (visible === 0 && data.photos.length > 0) {
      empty.querySelector('.bk-empty-title')!.textContent = 'Nothing matches.';
    }
  }
  syncUrl();
}

function syncUrl(): void {
  const params = new URLSearchParams();
  if (activeAlbum) params.set('album', activeAlbum);
  if (activeTags.size) params.set('tags', [...activeTags].join(','));
  const qs = params.toString();
  history.replaceState(history.state, '', qs ? `?${qs}` : location.pathname);
}

function bindChips(): void {
  for (const chip of document.querySelectorAll<HTMLElement>('.chip-album')) {
    chip.addEventListener('click', () => {
      activeAlbum = chip.dataset.album ?? '';
      for (const c of document.querySelectorAll('.chip-album')) {
        c.classList.toggle('is-active', c === chip);
      }
      applyFilters();
    });
  }
  for (const chip of document.querySelectorAll<HTMLElement>('.chip-tag')) {
    chip.addEventListener('click', () => {
      const tag = chip.dataset.tag!;
      if (activeTags.has(tag)) activeTags.delete(tag);
      else activeTags.add(tag);
      chip.classList.toggle('is-active', activeTags.has(tag));
      applyFilters();
    });
  }
  document.getElementById('clear-filters')?.addEventListener('click', () => {
    activeAlbum = '';
    activeTags.clear();
    for (const c of document.querySelectorAll('.chip')) c.classList.remove('is-active');
    document.querySelector('.chip-album[data-album=""]')?.classList.add('is-active');
    applyFilters();
  });
}

function restoreFromUrl(): void {
  const params = new URLSearchParams(location.search);
  const album = params.get('album');
  if (album && data.albums.some((a) => a.id === album)) {
    activeAlbum = album;
    for (const c of document.querySelectorAll<HTMLElement>('.chip-album')) {
      c.classList.toggle('is-active', (c.dataset.album ?? '') === album);
    }
  }
  for (const tag of (params.get('tags') ?? '').split(',').filter(Boolean)) {
    const chip = document.querySelector<HTMLElement>(`.chip-tag[data-tag="${CSS.escape(tag)}"]`);
    if (chip) {
      activeTags.add(tag);
      chip.classList.add('is-active');
    }
  }
  if (activeAlbum || activeTags.size) applyFilters();
}

// ----------------------------------------------------------------- lightbox

const lightbox = new Lightbox({
  getItems: () => data.photos.filter(matches),
  getThumbEl: (id) => {
    const el = cells.get(id);
    return el && !el.classList.contains('is-hidden') ? el : null;
  },
});

grid.addEventListener('click', (e) => {
  const cell = (e.target as HTMLElement).closest<HTMLElement>('.ph');
  if (cell?.dataset.id) lightbox.open(cell.dataset.id);
});

// Reveal thumbs softly as they load.
for (const img of grid.querySelectorAll<HTMLImageElement>('img')) {
  if (img.complete && img.naturalWidth > 0) img.classList.add('is-loaded');
  else img.addEventListener('load', () => img.classList.add('is-loaded'), { once: true });
}

bindChips();
restoreFromUrl();

// Deep link: /book#p-<id>
const hash = location.hash.match(/^#p-(.+)$/);
if (hash && cells.has(hash[1])) {
  history.replaceState(null, '', location.pathname + location.search);
  requestAnimationFrame(() => lightbox.open(hash[1]));
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
