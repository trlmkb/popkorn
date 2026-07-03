# POPKØRN

A self-hosted, Instagram-ish **photobook**: a minimal public gallery with a
serious back office. Front of house is quiet — photographs, a zoom, a couple
of filter chips. Back of house is a Lightroom-lite: drag-drop uploads, tags,
albums, publish/draft, bulk editing, keyboard shortcuts.

| Route | What |
| --- | --- |
| `/` | The existing GPGPU grid-distortion intro (untouched) |
| `/book` | Public photobook — justified grid, tag & album filters, zoom lightbox |
| `/admin` | The studio (password-protected back office) |

## Quick start

```sh
pnpm install
pnpm dev          # http://localhost:4321
```

Open `/admin`, sign in (default password `popkorn` until you set
`ADMIN_PASSWORD`), drop photos onto the window, tag them, hit publish.
They appear in `/book`.

## Environment

| Var | Default | Purpose |
| --- | --- | --- |
| `ADMIN_PASSWORD` | `popkorn` (dev fallback) | Studio login — **set this in production** |
| `SESSION_SECRET` | derived from password | Cookie signing key (optional) |
| `DATA_DIR` | `./data` | Where the local driver keeps images + `db.json` |
| `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` | — | Setting both switches storage to Supabase |

## Hosting

**Option A — one box, zero services (Fly.io / Railway / any Docker host).**
Images and metadata live on a mounted volume; the included `Dockerfile` and
`fly.toml` are ready:

```sh
fly launch --copy-config
fly volumes create popkorn_data --size 3
fly secrets set ADMIN_PASSWORD=…
fly deploy
```

**Option B — serverless (Vercel / Netlify) + Supabase.**
Create a free Supabase project, paste `supabase/schema.sql` into its SQL
editor, then set `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` and `ADMIN_PASSWORD`
on the host and swap the adapter in `astro.config.mjs`
(`@astrojs/vercel` / `@astrojs/netlify` instead of `@astrojs/node`).

## The studio

- **Upload**: button, drag-drop anywhere, or paste from clipboard. Images are
  resized in *your browser* (2560px display + 640px thumb, WebP) before
  upload, so the server never does image work and uploads are fast.
- **Publish on upload** toggle lives in the upload queue.
- **Organize**: tags (the only taxonomy — free-form, autocompleted) and
  albums. Filter by scope, tag or search; bulk-edit via multi-select.
- **Keyboard**: `⌘A` select all · `P` publish/unpublish · `X` toggle select ·
  `⏎` loupe · `⌫` delete · `Esc` clear · arrows to move.
- Everything autosaves.

## The book

- Justified grid (no crops beyond gentle cover-fit), tag chips, album chips.
- Click a photo: it morphs into a full-screen lightbox. Scroll or pinch to
  zoom (up to 6×), drag to pan, swipe or arrow keys to navigate, swipe down
  to dismiss. Deep-linkable (`/book#p-<id>`), filters live in the URL.

## PWA / iOS

The site ships a manifest + service worker: on iPhone use *Share → Add to
Home Screen* and both the book and the studio run full-screen like an app,
with cached photos available offline. If a real App Store build is ever
wanted, the same codebase can be wrapped with Capacitor.

## Stack

Astro 7 (SSR, Node adapter) · vanilla TypeScript · GSAP for the lightbox
physics · Inter + Fraunces (self-hosted) · no client framework, no database
server required.
