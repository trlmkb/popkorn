import type { Album, Photo, PhotoPatch } from '../../lib/store/types';
import { Lightbox } from '../lightbox';
import { api } from './api';
import { processImage } from './process';

// --------------------------------------------------------------------- state

const initial = JSON.parse(document.getElementById('pk-data')!.textContent!) as {
  photos: Photo[];
  albums: Album[];
};

let photos: Photo[] = initial.photos;
let albums: Album[] = initial.albums;

type Scope = { kind: 'all' | 'published' | 'draft' } | { kind: 'album'; id: string };
let scope: Scope = { kind: 'all' };
const filterTags = new Set<string>();
let query = '';
let sortOrder: 'new' | 'old' = (localStorage.getItem('pk.sort') as 'new' | 'old') || 'new';
const selection = new Set<string>();
let anchorId: string | null = null;

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const gridEl = $('grid');
const sideEl = $('side');
const inspEl = $('insp');
const libheadEl = $('libhead');
const gridEmptyEl = $('grid-empty');
const queueEl = $('queue');
const toastsEl = $('toasts');
const dropEl = $('drop');
const searchEl = $('search') as HTMLInputElement;
const sortEl = $('sort') as unknown as HTMLSelectElement;
const sizeEl = $('thumb-size') as HTMLInputElement;
const fileInput = $('file-input') as HTMLInputElement;

const byId = (id: string) => photos.find((p) => p.id === id);
const albumById = (id: string | null) => albums.find((a) => a.id === id);
const dateKey = (p: Photo) => p.takenAt || p.createdAt;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function inScope(p: Photo): boolean {
  if (scope.kind === 'published' && !p.published) return false;
  if (scope.kind === 'draft' && p.published) return false;
  if (scope.kind === 'album' && p.albumId !== scope.id) return false;
  return true;
}

function visible(): Photo[] {
  const q = query.trim().toLowerCase();
  const out = photos.filter((p) => {
    if (!inScope(p)) return false;
    if (filterTags.size && ![...filterTags].every((t) => p.tags.includes(t))) return false;
    if (q && !p.caption.toLowerCase().includes(q) && !p.tags.some((t) => t.includes(q))) {
      return false;
    }
    return true;
  });
  out.sort((a, b) =>
    sortOrder === 'new' ? dateKey(b).localeCompare(dateKey(a)) : dateKey(a).localeCompare(dateKey(b))
  );
  return out;
}

function tagCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of photos) for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
}

// -------------------------------------------------------------------- toasts

function toast(msg: string, kind: 'info' | 'error' = 'info'): void {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = msg;
  toastsEl.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  setTimeout(() => {
    el.classList.remove('is-in');
    setTimeout(() => el.remove(), 350);
  }, 3200);
}

// ------------------------------------------------------------------ autosave

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingPatch = new Map<string, PhotoPatch>();

function savePhoto(id: string, patch: PhotoPatch, delay = 600): void {
  const p = byId(id);
  if (!p) return;
  Object.assign(p, patch);
  pendingPatch.set(id, { ...pendingPatch.get(id), ...patch });
  clearTimeout(saveTimers.get(id));
  saveTimers.set(
    id,
    setTimeout(async () => {
      const body = pendingPatch.get(id);
      pendingPatch.delete(id);
      if (!body) return;
      try {
        const saved = await api.patchPhoto(id, body);
        const local = byId(id);
        // Adopt server-side normalization (e.g. tag sanitizing) unless the
        // user has typed again meanwhile.
        if (local && !pendingPatch.has(id)) Object.assign(local, saved);
        flashSaved();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Save failed', 'error');
      }
    }, delay)
  );
}

let savedFlashTimer: ReturnType<typeof setTimeout> | undefined;
function flashSaved(): void {
  const el = inspEl.querySelector<HTMLElement>('.insp-saved');
  if (!el) return;
  el.classList.add('is-on');
  clearTimeout(savedFlashTimer);
  savedFlashTimer = setTimeout(() => el.classList.remove('is-on'), 1200);
}

// ------------------------------------------------------------------- sidebar

function renderSide(): void {
  const pub = photos.filter((p) => p.published).length;
  const counts = tagCounts();
  const tags = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const albumCount = (id: string) => photos.filter((p) => p.albumId === id).length;
  const active = (k: string) =>
    (scope.kind === 'album' ? `album:${scope.id}` : scope.kind) === k ? ' is-active' : '';

  sideEl.innerHTML = `
    <div class="sd-sec">
      <button class="sd-item${active('all')}" data-scope="all">
        <span>All photos</span><span class="sd-n">${photos.length}</span>
      </button>
      <button class="sd-item${active('published')}" data-scope="published">
        <span>Published</span><span class="sd-n">${pub}</span>
      </button>
      <button class="sd-item${active('draft')}" data-scope="draft">
        <span>Drafts</span><span class="sd-n">${photos.length - pub}</span>
      </button>
    </div>
    <div class="sd-sec">
      <div class="sd-h">Albums <button class="sd-add" id="album-add" title="New album">+</button></div>
      <div id="album-new-row" hidden><input id="album-new" class="sd-input" placeholder="Album name…" /></div>
      ${albums
        .map(
          (a) => `
        <button class="sd-item${active(`album:${a.id}`)}" data-scope="album:${a.id}">
          <span>${esc(a.title)}</span><span class="sd-n">${albumCount(a.id)}</span>
        </button>`
        )
        .join('')}
      ${albums.length === 0 ? '<div class="sd-none">No albums yet</div>' : ''}
    </div>
    ${
      tags.length
        ? `<div class="sd-sec">
            <div class="sd-h">Tags</div>
            <div class="sd-tags">
              ${tags
                .map(
                  ([t, n]) =>
                    `<button class="sd-tag${filterTags.has(t) ? ' is-active' : ''}" data-tag="${esc(t)}">${esc(t)}<span>${n}</span></button>`
                )
                .join('')}
            </div>
          </div>`
        : ''
    }`;

  sideEl.querySelectorAll<HTMLElement>('[data-scope]').forEach((el) => {
    el.addEventListener('click', () => {
      const v = el.dataset.scope!;
      scope = v.startsWith('album:')
        ? { kind: 'album', id: v.slice(6) }
        : { kind: v as 'all' | 'published' | 'draft' };
      selection.clear();
      renderAll();
    });
  });
  sideEl.querySelectorAll<HTMLElement>('.sd-tag').forEach((el) => {
    el.addEventListener('click', () => {
      const t = el.dataset.tag!;
      if (filterTags.has(t)) filterTags.delete(t);
      else filterTags.add(t);
      renderAll();
    });
  });

  const addBtn = $('album-add');
  const newRow = $('album-new-row');
  const newInput = $('album-new') as HTMLInputElement;
  addBtn.addEventListener('click', () => {
    newRow.hidden = false;
    newInput.focus();
  });
  newInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') {
      newRow.hidden = true;
    } else if (e.key === 'Enter' && newInput.value.trim()) {
      try {
        const album = await api.createAlbum(newInput.value.trim());
        albums.push(album);
        scope = { kind: 'album', id: album.id };
        renderAll();
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Could not create album', 'error');
      }
    }
  });
}

// ------------------------------------------------------------- library head

function scopeTitle(): string {
  if (scope.kind === 'album') return albumById(scope.id)?.title ?? 'Album';
  return { all: 'All photos', published: 'Published', draft: 'Drafts' }[scope.kind];
}

function renderLibhead(): void {
  const n = visible().length;
  const albumScope = scope.kind === 'album' ? albumById(scope.id) : null;
  libheadEl.innerHTML = `
    <h1 class="lh-title">${esc(scopeTitle())}</h1>
    <span class="lh-n">${n} photo${n === 1 ? '' : 's'}</span>
    ${
      albumScope
        ? `<span class="lh-actions">
            <button class="lh-btn" id="album-rename">Rename</button>
            <button class="lh-btn lh-danger" id="album-delete">Delete album</button>
            <a class="lh-btn" href="/book?album=${albumScope.id}" target="_blank" rel="noopener">View in book ↗</a>
          </span>`
        : ''
    }
    ${
      filterTags.size
        ? `<span class="lh-filter">filtered: ${[...filterTags].map(esc).join(', ')}
            <button class="lh-btn" id="clear-tagfilter">clear</button></span>`
        : ''
    }
    <span class="lh-sel" ${selection.size ? '' : 'hidden'}>
      ${selection.size} selected
      <button class="lh-btn" id="clear-sel">clear</button>
    </span>`;

  document.getElementById('clear-sel')?.addEventListener('click', () => {
    selection.clear();
    updateSelectionUI();
  });
  document.getElementById('clear-tagfilter')?.addEventListener('click', () => {
    filterTags.clear();
    renderAll();
  });
  document.getElementById('album-rename')?.addEventListener('click', async () => {
    if (!albumScope) return;
    const title = prompt('Album name', albumScope.title)?.trim();
    if (!title || title === albumScope.title) return;
    try {
      const saved = await api.patchAlbum(albumScope.id, { title });
      Object.assign(albumScope, saved);
      renderAll();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Rename failed', 'error');
    }
  });
  document.getElementById('album-delete')?.addEventListener('click', async () => {
    if (!albumScope) return;
    if (!confirm(`Delete album “${albumScope.title}”? Photos stay in the library.`)) return;
    try {
      await api.deleteAlbum(albumScope.id);
      albums = albums.filter((a) => a.id !== albumScope.id);
      for (const p of photos) if (p.albumId === albumScope.id) p.albumId = null;
      scope = { kind: 'all' };
      renderAll();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  });
}

// ---------------------------------------------------------------------- grid

function cellHtml(p: Photo): string {
  const ar = (p.width / Math.max(1, p.height)).toFixed(4);
  return `
    <div class="cell${selection.has(p.id) ? ' is-sel' : ''}" data-id="${p.id}" tabindex="0"
         style="--ar:${ar};background-color:${p.color}">
      <img src="${p.thumb}" alt="${esc(p.caption)}" loading="lazy" decoding="async" />
      ${p.published ? '' : '<span class="cell-draft">draft</span>'}
      <button class="cell-check" tabindex="-1" aria-label="Select photo">
        <svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>
      </button>
    </div>`;
}

function renderGrid(): void {
  const items = visible();
  gridEl.innerHTML = items.map(cellHtml).join('');
  if (photos.length === 0) {
    gridEmptyEl.hidden = false;
    gridEmptyEl.innerHTML = `
      <div class="ge-inner">
        <p class="ge-title">Your library is empty.</p>
        <p class="ge-sub">Drop photos anywhere, paste from the clipboard,<br/>or</p>
        <button class="btn btn-acc" id="ge-upload">Choose photos</button>
      </div>`;
    document.getElementById('ge-upload')?.addEventListener('click', () => fileInput.click());
  } else if (items.length === 0) {
    gridEmptyEl.hidden = false;
    gridEmptyEl.innerHTML = `<div class="ge-inner"><p class="ge-title">Nothing matches.</p></div>`;
  } else {
    gridEmptyEl.hidden = true;
  }
}

function updateSelectionUI(): void {
  for (const cell of gridEl.querySelectorAll<HTMLElement>('.cell')) {
    cell.classList.toggle('is-sel', selection.has(cell.dataset.id!));
  }
  document.body.classList.toggle('has-sel', selection.size > 0);
  renderLibhead();
  renderInspector();
}

function selectRange(toId: string): void {
  const order = visible().map((p) => p.id);
  const a = order.indexOf(anchorId ?? toId);
  const b = order.indexOf(toId);
  if (a === -1 || b === -1) return;
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) selection.add(order[i]);
}

gridEl.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const cell = target.closest<HTMLElement>('.cell');
  if (!cell) return;
  const id = cell.dataset.id!;
  if (target.closest('.cell-check')) {
    if (selection.has(id)) selection.delete(id);
    else selection.add(id);
    anchorId = id;
  } else if (e.shiftKey && anchorId) {
    selectRange(id);
  } else if (e.metaKey || e.ctrlKey) {
    if (selection.has(id)) selection.delete(id);
    else selection.add(id);
    anchorId = id;
  } else {
    selection.clear();
    selection.add(id);
    anchorId = id;
  }
  updateSelectionUI();
});

gridEl.addEventListener('dblclick', (e) => {
  const cell = (e.target as HTMLElement).closest<HTMLElement>('.cell');
  if (cell) openLoupe(cell.dataset.id!);
});

// ------------------------------------------------------------------- keyboard

function isEditing(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
  );
}

document.addEventListener('keydown', (e) => {
  if (isEditing(e.target)) {
    if (e.key === 'Escape') (e.target as HTMLElement).blur();
    return;
  }
  if (document.documentElement.classList.contains('lb-open')) return;

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    for (const p of visible()) selection.add(p.id);
    updateSelectionUI();
    return;
  }
  if (e.key === 'Escape') {
    selection.clear();
    updateSelectionUI();
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selection.size) {
    e.preventDefault();
    deleteSelected();
    return;
  }
  if (e.key.toLowerCase() === 'p' && selection.size) {
    togglePublishSelected();
    return;
  }
  if (e.key.toLowerCase() === 'x' && anchorId) {
    if (selection.has(anchorId)) selection.delete(anchorId);
    else selection.add(anchorId);
    updateSelectionUI();
    return;
  }
  if (e.key === 'Enter' && anchorId) {
    openLoupe(anchorId);
    return;
  }
  if (e.key.startsWith('Arrow')) {
    const order = visible().map((p) => p.id);
    if (!order.length) return;
    e.preventDefault();
    const cols = Math.max(1, Math.round(gridEl.clientWidth / (parseInt(sizeEl.value) * 1.2)));
    let i = anchorId ? order.indexOf(anchorId) : -1;
    if (e.key === 'ArrowRight') i = Math.min(order.length - 1, i + 1);
    else if (e.key === 'ArrowLeft') i = Math.max(0, i - 1);
    else if (e.key === 'ArrowDown') i = Math.min(order.length - 1, i + cols);
    else if (e.key === 'ArrowUp') i = Math.max(0, i - cols);
    anchorId = order[Math.max(0, i)];
    selection.clear();
    selection.add(anchorId);
    gridEl.querySelector<HTMLElement>(`.cell[data-id="${anchorId}"]`)?.scrollIntoView({
      block: 'nearest',
    });
    updateSelectionUI();
  }
});

// ----------------------------------------------------------------- inspector

function tagbox(
  container: HTMLElement,
  getTags: () => string[],
  onChange: (tags: string[]) => void
): void {
  const render = () => {
    const tags = getTags();
    container.innerHTML = `
      ${tags
        .map(
          (t) =>
            `<span class="tag">${esc(t)}<button class="tag-x" data-tag="${esc(t)}" aria-label="Remove tag">×</button></span>`
        )
        .join('')}
      <input class="tag-in" placeholder="${tags.length ? '' : 'Add tags…'}" />
      <div class="tag-sug" hidden></div>`;
    const input = container.querySelector<HTMLInputElement>('.tag-in')!;
    const sug = container.querySelector<HTMLElement>('.tag-sug')!;

    const commit = (raw: string) => {
      const t = raw.trim().toLowerCase();
      if (!t) return;
      const tags = getTags();
      if (!tags.includes(t)) onChange([...tags, t]);
      render();
      container.querySelector<HTMLInputElement>('.tag-in')?.focus();
    };

    const refreshSug = () => {
      const q = input.value.trim().toLowerCase();
      const current = new Set(getTags());
      const matches = [...tagCounts().entries()]
        .filter(([t]) => !current.has(t) && (!q || t.includes(q)))
        .sort((a, b) => b[1] - a[1])
        .slice(0, 7);
      if (!matches.length || (!q && document.activeElement !== input)) {
        sug.hidden = true;
        return;
      }
      sug.hidden = false;
      sug.innerHTML = matches
        .map(([t, n]) => `<button class="tag-sug-i" data-tag="${esc(t)}">${esc(t)}<span>${n}</span></button>`)
        .join('');
      sug.querySelectorAll<HTMLElement>('.tag-sug-i').forEach((b) =>
        b.addEventListener('mousedown', (e) => {
          e.preventDefault();
          commit(b.dataset.tag!);
        })
      );
    };

    input.addEventListener('input', refreshSug);
    input.addEventListener('focus', refreshSug);
    input.addEventListener('blur', () => setTimeout(() => (sug.hidden = true), 150));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
        if (input.value.trim()) {
          e.preventDefault();
          commit(input.value);
        }
      } else if (e.key === 'Backspace' && !input.value) {
        const tags = getTags();
        if (tags.length) {
          onChange(tags.slice(0, -1));
          render();
          container.querySelector<HTMLInputElement>('.tag-in')?.focus();
        }
      }
    });
    container.querySelectorAll<HTMLElement>('.tag-x').forEach((b) =>
      b.addEventListener('click', () => {
        onChange(getTags().filter((t) => t !== b.dataset.tag));
        render();
      })
    );
    container.addEventListener('click', (e) => {
      if (e.target === container) input.focus();
    });
  };
  render();
}

function albumOptions(selected: string | null, mixed = false): string {
  return `
    ${mixed ? '<option value="__mixed" selected>— mixed —</option>' : ''}
    <option value="" ${!mixed && !selected ? 'selected' : ''}>No album</option>
    ${albums
      .map(
        (a) =>
          `<option value="${a.id}" ${!mixed && selected === a.id ? 'selected' : ''}>${esc(a.title)}</option>`
      )
      .join('')}`;
}

function renderInspector(): void {
  const ids = [...selection];

  if (ids.length === 0) {
    const pub = photos.filter((p) => p.published).length;
    inspEl.innerHTML = `
      <div class="insp-blank">
        <div class="insp-stat"><b>${photos.length}</b> photos · <b>${pub}</b> published</div>
        <p>Select a photo to edit it.</p>
        <dl class="insp-keys">
          <div><dt>⌘A</dt><dd>select all</dd></div>
          <div><dt>P</dt><dd>publish / unpublish</dd></div>
          <div><dt>⏎</dt><dd>loupe view</dd></div>
          <div><dt>⌫</dt><dd>delete</dd></div>
        </dl>
      </div>`;
    return;
  }

  if (ids.length === 1) {
    const p = byId(ids[0]);
    if (!p) return;
    const album = albumById(p.albumId);
    const date = new Date(dateKey(p));
    inspEl.innerHTML = `
      <div class="insp-head">
        <span>Photo</span>
        <span class="insp-saved">Saved</span>
        <button class="insp-close" id="insp-close" aria-label="Close">×</button>
      </div>
      <button class="insp-prev" id="insp-prev" style="--ar:${(p.width / Math.max(1, p.height)).toFixed(4)};background-color:${p.color}" title="Open loupe">
        <img src="${p.thumb}" alt="" />
      </button>
      <div class="insp-body">
        <label class="f-label" for="f-caption">Caption</label>
        <textarea id="f-caption" rows="2" placeholder="Say something…">${esc(p.caption)}</textarea>
        <label class="f-label">Tags</label>
        <div class="tagbox" id="f-tags"></div>
        <label class="f-label" for="f-album">Album</label>
        <select id="f-album" class="ad-select f-album">${albumOptions(p.albumId)}</select>
        <div class="f-switchrow">
          <span class="f-label">Published</span>
          <button class="switch${p.published ? ' is-on' : ''}" id="f-pub" role="switch" aria-checked="${p.published}"></button>
        </div>
        <div class="f-meta">
          ${p.width} × ${p.height} · ${date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
        </div>
        <div class="f-actions">
          ${p.published ? `<a class="btn btn-ghost" href="/book#p-${p.id}" target="_blank" rel="noopener">View in book ↗</a>` : ''}
          ${album ? `<button class="btn btn-ghost" id="f-cover">${album.coverId === p.id ? 'Album cover ✓' : 'Set as album cover'}</button>` : ''}
          <button class="btn btn-danger" id="f-del">Delete</button>
        </div>
      </div>`;

    $('insp-close').addEventListener('click', () => {
      selection.clear();
      updateSelectionUI();
    });
    $('insp-prev').addEventListener('click', () => openLoupe(p.id));
    const caption = $('f-caption') as unknown as HTMLTextAreaElement;
    caption.addEventListener('input', () => savePhoto(p.id, { caption: caption.value }));
    tagbox(
      $('f-tags'),
      () => p.tags,
      (tags) => {
        savePhoto(p.id, { tags });
        renderSide();
      }
    );
    const albumSel = $('f-album') as unknown as HTMLSelectElement;
    albumSel.addEventListener('change', () => {
      savePhoto(p.id, { albumId: albumSel.value || null }, 0);
      renderSide();
      renderGrid();
      updateSelectionUI();
    });
    $('f-pub').addEventListener('click', () => {
      savePhoto(p.id, { published: !p.published }, 0);
      renderSide();
      renderGrid();
      updateSelectionUI();
    });
    document.getElementById('f-cover')?.addEventListener('click', async () => {
      if (!album) return;
      try {
        const saved = await api.patchAlbum(album.id, { coverId: p.id });
        Object.assign(album, saved);
        renderInspector();
        toast('Album cover set');
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Failed', 'error');
      }
    });
    $('f-del').addEventListener('click', () => deleteSelected());
    return;
  }

  // ----- bulk
  const sel = ids.map(byId).filter(Boolean) as Photo[];
  const common = sel[0].tags.filter((t) => sel.every((p) => p.tags.includes(t)));
  const sameAlbum = sel.every((p) => p.albumId === sel[0].albumId);
  const allPublished = sel.every((p) => p.published);
  const nonePublished = sel.every((p) => !p.published);

  inspEl.innerHTML = `
    <div class="insp-head">
      <span>${sel.length} photos</span>
      <span class="insp-saved">Saved</span>
      <button class="insp-close" id="insp-close" aria-label="Close">×</button>
    </div>
    <div class="insp-strip">
      ${sel.slice(0, 7).map((p) => `<img src="${p.thumb}" alt="" style="background-color:${p.color}" />`).join('')}
      ${sel.length > 7 ? `<span class="insp-strip-more">+${sel.length - 7}</span>` : ''}
    </div>
    <div class="insp-body">
      <label class="f-label">Add tags to all</label>
      <div class="tagbox" id="b-tags"></div>
      ${
        common.length
          ? `<label class="f-label">Shared tags</label>
             <div class="b-common">${common
               .map(
                 (t) =>
                   `<span class="tag">${esc(t)}<button class="tag-x" data-tag="${esc(t)}" aria-label="Remove from all">×</button></span>`
               )
               .join('')}</div>`
          : ''
      }
      <label class="f-label" for="b-album">Album</label>
      <select id="b-album" class="ad-select f-album">${albumOptions(sameAlbum ? sel[0].albumId : null, !sameAlbum)}</select>
      <div class="f-actions">
        ${allPublished ? '' : '<button class="btn btn-ghost" id="b-pub">Publish all</button>'}
        ${nonePublished ? '' : '<button class="btn btn-ghost" id="b-unpub">Unpublish all</button>'}
        <button class="btn btn-danger" id="b-del">Delete ${sel.length}</button>
      </div>
    </div>`;

  $('insp-close').addEventListener('click', () => {
    selection.clear();
    updateSelectionUI();
  });
  tagbox(
    $('b-tags'),
    () => [],
    (tags) => {
      for (const p of sel) {
        savePhoto(p.id, { tags: [...new Set([...p.tags, ...tags])] });
      }
      renderSide();
      toast(`Tag added to ${sel.length} photos`);
    }
  );
  inspEl.querySelectorAll<HTMLElement>('.b-common .tag-x').forEach((b) =>
    b.addEventListener('click', () => {
      for (const p of sel) savePhoto(p.id, { tags: p.tags.filter((t) => t !== b.dataset.tag) });
      renderSide();
      renderInspector();
    })
  );
  const bAlbum = $('b-album') as unknown as HTMLSelectElement;
  bAlbum.addEventListener('change', () => {
    if (bAlbum.value === '__mixed') return;
    for (const p of sel) savePhoto(p.id, { albumId: bAlbum.value || null });
    renderSide();
    renderGrid();
    updateSelectionUI();
  });
  document.getElementById('b-pub')?.addEventListener('click', () => setPublished(sel, true));
  document.getElementById('b-unpub')?.addEventListener('click', () => setPublished(sel, false));
  $('b-del').addEventListener('click', () => deleteSelected());
}

function setPublished(sel: Photo[], published: boolean): void {
  for (const p of sel) savePhoto(p.id, { published }, 0);
  renderSide();
  renderGrid();
  updateSelectionUI();
  toast(published ? `Published ${sel.length}` : `Unpublished ${sel.length}`);
}

function togglePublishSelected(): void {
  const sel = [...selection].map(byId).filter(Boolean) as Photo[];
  if (!sel.length) return;
  setPublished(sel, !sel.every((p) => p.published));
}

async function deleteSelected(): Promise<void> {
  const ids = [...selection];
  if (!ids.length) return;
  const label = ids.length === 1 ? 'this photo' : `${ids.length} photos`;
  if (!confirm(`Delete ${label}? This can’t be undone.`)) return;
  selection.clear();
  for (const id of ids) {
    try {
      await api.deletePhoto(id);
      photos = photos.filter((p) => p.id !== id);
    } catch (err) {
      toast(err instanceof Error ? err.message : `Failed to delete ${id}`, 'error');
    }
  }
  renderAll();
  toast(`Deleted ${label}`);
}

// --------------------------------------------------------------------- loupe

const loupe = new Lightbox({
  getItems: () => visible(),
  getThumbEl: (id) => gridEl.querySelector<HTMLElement>(`.cell[data-id="${id}"]`),
});

function openLoupe(id: string): void {
  loupe.open(id);
}

// -------------------------------------------------------------------- upload

interface QItem {
  id: number;
  name: string;
  status: 'waiting' | 'processing' | 'uploading' | 'done' | 'error';
  progress: number;
  error?: string;
}

const queue: QItem[] = [];
let qid = 0;
let pumping = false;
let activeUploads = 0;
let publishOnUpload = localStorage.getItem('pk.publishOnUpload') === '1';
const pendingFiles = new Map<number, File>();

function enqueueFiles(files: Iterable<File>): void {
  let added = 0;
  for (const f of files) {
    if (!f.type.startsWith('image/') && !/\.(heic|heif)$/i.test(f.name)) continue;
    const item: QItem = { id: ++qid, name: f.name, status: 'waiting', progress: 0 };
    queue.push(item);
    pendingFiles.set(item.id, f);
    added++;
  }
  if (!added) {
    toast('No images in that drop', 'error');
    return;
  }
  renderQueue();
  void pump();
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  for (const item of queue) {
    if (item.status !== 'waiting') continue;
    const file = pendingFiles.get(item.id)!;
    item.status = 'processing';
    renderQueue();
    let processed;
    try {
      processed = await processImage(file);
    } catch {
      item.status = 'error';
      item.error = 'Could not read image';
      renderQueue();
      continue;
    }
    while (activeUploads >= 2) await new Promise((r) => setTimeout(r, 120));
    item.status = 'uploading';
    renderQueue();
    activeUploads++;
    void api
      .uploadPhoto(
        {
          ...processed.meta,
          albumId: scope.kind === 'album' ? scope.id : null,
          published: publishOnUpload,
        },
        processed.full,
        processed.thumb,
        (f) => {
          item.progress = f;
          const bar = queueEl.querySelector<HTMLElement>(`[data-q="${item.id}"] .q-bar b`);
          if (bar) bar.style.width = `${Math.round(f * 100)}%`;
        }
      )
      .then((photo) => {
        item.status = 'done';
        photos.unshift(photo);
        renderAll();
      })
      .catch((err) => {
        item.status = 'error';
        item.error = err instanceof Error ? err.message : 'Upload failed';
      })
      .finally(() => {
        activeUploads--;
        pendingFiles.delete(item.id);
        renderQueue();
      });
  }
  pumping = false;
}

function renderQueue(): void {
  if (!queue.length) {
    queueEl.hidden = true;
    return;
  }
  queueEl.hidden = false;
  const done = queue.filter((i) => i.status === 'done').length;
  const failed = queue.filter((i) => i.status === 'error').length;
  const busy = queue.length - done - failed;
  queueEl.innerHTML = `
    <div class="q-head">
      <span>${busy ? `Uploading ${done + 1} of ${queue.length}…` : failed ? `Done, ${failed} failed` : 'All uploaded'}</span>
      <label class="q-pub"><input type="checkbox" id="q-publish" ${publishOnUpload ? 'checked' : ''}/> publish on upload</label>
      <button class="q-close" id="q-close" aria-label="Close">×</button>
    </div>
    ${queue
      .slice(-30)
      .map(
        (i) => `
      <div class="q-item q-${i.status}" data-q="${i.id}">
        <span class="q-name">${esc(i.name)}</span>
        ${
          i.status === 'uploading'
            ? `<span class="q-bar"><b style="width:${Math.round(i.progress * 100)}%"></b></span>`
            : `<span class="q-status">${
                { waiting: '·', processing: 'resizing…', done: '✓', error: i.error ?? 'failed' }[i.status]
              }</span>`
        }
      </div>`
      )
      .join('')}`;
  document.getElementById('q-close')?.addEventListener('click', () => {
    queue.length = 0;
    renderQueue();
  });
  document.getElementById('q-publish')?.addEventListener('change', (e) => {
    publishOnUpload = (e.target as HTMLInputElement).checked;
    localStorage.setItem('pk.publishOnUpload', publishOnUpload ? '1' : '0');
  });
  if (!busy && !failed) {
    setTimeout(() => {
      if (queue.every((i) => i.status === 'done')) {
        queue.length = 0;
        renderQueue();
      }
    }, 2500);
  }
}

// Drag & drop + paste
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (e.dataTransfer?.types.includes('Files')) {
    dragDepth++;
    dropEl.hidden = false;
  }
});
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    dropEl.hidden = true;
  }
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropEl.hidden = true;
  if (e.dataTransfer?.files.length) enqueueFiles(e.dataTransfer.files);
});
document.addEventListener('paste', (e) => {
  if (isEditing(e.target)) return;
  if (e.clipboardData?.files.length) enqueueFiles(e.clipboardData.files);
});

// -------------------------------------------------------------------- topbar

$('upload-btn').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  if (fileInput.files?.length) enqueueFiles(fileInput.files);
  fileInput.value = '';
});
$('logout-btn').addEventListener('click', async () => {
  await api.logout().catch(() => {});
  location.href = '/admin/login';
});

let searchTimer: ReturnType<typeof setTimeout>;
searchEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    query = searchEl.value;
    renderGrid();
    renderLibhead();
  }, 180);
});

sortEl.value = sortOrder;
sortEl.addEventListener('change', () => {
  sortOrder = sortEl.value as 'new' | 'old';
  localStorage.setItem('pk.sort', sortOrder);
  renderGrid();
});

const savedSize = localStorage.getItem('pk.thumbSize');
if (savedSize) sizeEl.value = savedSize;
const applySize = () => {
  document.documentElement.style.setProperty('--cell', `${sizeEl.value}px`);
};
sizeEl.addEventListener('input', () => {
  applySize();
  localStorage.setItem('pk.thumbSize', sizeEl.value);
});
applySize();

// ---------------------------------------------------------------------- init

function renderAll(): void {
  renderSide();
  renderLibhead();
  renderGrid();
  updateSelectionUI();
}

renderAll();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
