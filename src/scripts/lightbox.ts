import gsap from 'gsap';

export interface LightboxItem {
  id: string;
  full: string;
  thumb: string;
  width: number;
  height: number;
  caption: string;
  tags: string[];
  color: string;
}

export interface LightboxOptions {
  /** Current (filtered) item list; called on open so navigation follows filters. */
  getItems(): LightboxItem[];
  /** Grid element for a photo, used for the open/close morph. */
  getThumbEl(id: string): HTMLElement | null;
}

const MAX_SCALE = 6;
const SWIPE_PX = 70;
const DISMISS_PX = 110;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Gesture =
  | { type: 'pending'; x0: number; y0: number }
  | { type: 'pan'; x0: number; y0: number; tx0: number; ty0: number }
  | { type: 'swipe'; x0: number; y0: number; lastX: number; lastT: number; vx: number }
  | { type: 'dismiss'; x0: number; y0: number }
  | { type: 'pinch'; d0: number; mx0: number; my0: number; s0: number; tx0: number; ty0: number };

export class Lightbox {
  private root: HTMLDivElement;
  private backdrop: HTMLDivElement;
  private stage: HTMLDivElement;
  private zoomer: HTMLDivElement;
  private imgLo: HTMLImageElement;
  private imgHi: HTMLImageElement;
  private metaBar: HTMLDivElement;
  private captionEl: HTMLDivElement;
  private tagsEl: HTMLDivElement;
  private countEl: HTMLDivElement;
  private closeBtn: HTMLButtonElement;
  private prevBtn: HTMLButtonElement;
  private nextBtn: HTMLButtonElement;

  private items: LightboxItem[] = [];
  private idx = -1;
  private fit: Rect = { x: 0, y: 0, w: 0, h: 0 };
  private s = 1;
  private tx = 0;
  private ty = 0;

  private isOpen = false;
  private closing = false;
  private hiddenThumb: HTMLElement | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: Gesture | null = null;
  private lastTap = 0;
  private pushedState = false;
  private hiToken = 0;

  constructor(private opts: LightboxOptions) {
    this.root = document.createElement('div');
    this.root.className = 'lb';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Photo viewer');
    this.root.innerHTML = `
      <div class="lb-backdrop"></div>
      <div class="lb-stage">
        <div class="lb-zoomer">
          <img class="lb-img lb-img-lo" alt="" draggable="false" />
          <img class="lb-img lb-img-hi" alt="" draggable="false" />
        </div>
      </div>
      <button class="lb-close" aria-label="Close">
        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
      <button class="lb-nav lb-prev" aria-label="Previous photo">
        <svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>
      </button>
      <button class="lb-nav lb-next" aria-label="Next photo">
        <svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>
      </button>
      <div class="lb-meta">
        <div class="lb-caption"></div>
        <div class="lb-tags"></div>
        <div class="lb-count"></div>
      </div>`;
    document.body.appendChild(this.root);

    const q = <T extends Element>(sel: string) => this.root.querySelector(sel) as T;
    this.backdrop = q('.lb-backdrop');
    this.stage = q('.lb-stage');
    this.zoomer = q('.lb-zoomer');
    this.imgLo = q('.lb-img-lo');
    this.imgHi = q('.lb-img-hi');
    this.metaBar = q('.lb-meta');
    this.captionEl = q('.lb-caption');
    this.tagsEl = q('.lb-tags');
    this.countEl = q('.lb-count');
    this.closeBtn = q('.lb-close');
    this.prevBtn = q('.lb-prev');
    this.nextBtn = q('.lb-next');

    this.closeBtn.addEventListener('click', () => this.close());
    this.prevBtn.addEventListener('click', () => this.step(-1));
    this.nextBtn.addEventListener('click', () => this.step(1));

    this.stage.addEventListener('wheel', this.onWheel, { passive: false });
    this.stage.addEventListener('pointerdown', this.onPointerDown);
    this.stage.addEventListener('pointermove', this.onPointerMove);
    this.stage.addEventListener('pointerup', this.onPointerUp);
    this.stage.addEventListener('pointercancel', this.onPointerUp);
    this.stage.addEventListener('dblclick', (e) => {
      e.preventDefault();
      this.toggleZoom(e.clientX, e.clientY);
    });

    window.addEventListener('keydown', this.onKey);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('popstate', () => {
      if (this.isOpen && !this.closing) {
        this.pushedState = false;
        this.close();
      }
    });
  }

  // ---------------------------------------------------------------- opening

  open(id: string): void {
    this.items = this.opts.getItems();
    const idx = this.items.findIndex((it) => it.id === id);
    if (idx === -1) return;
    this.idx = idx;
    this.isOpen = true;
    this.closing = false;
    this.root.hidden = false;
    document.documentElement.classList.add('lb-open');

    const item = this.items[idx];
    this.setItem(item);
    this.resetTransform();

    try {
      history.pushState({ pkLightbox: true }, '', `#p-${item.id}`);
      this.pushedState = true;
    } catch {
      this.pushedState = false;
    }

    const thumb = this.opts.getThumbEl(item.id);
    gsap.fromTo(this.backdrop, { opacity: 0 }, { opacity: 1, duration: 0.45, ease: 'power2.out' });
    gsap.fromTo(this.metaBar, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.4, delay: 0.2 });

    if (thumb) {
      this.hiddenThumb = thumb;
      const r = thumb.getBoundingClientRect();
      const f = this.fit;
      // Morph from the (cover-cropped) grid cell to the fitted image:
      // scale so the image covers the cell, clip to the cell, then relax both.
      const s0 = Math.max(r.width / f.w, r.height / f.h);
      const dx = r.left + r.width / 2 - (f.x + f.w / 2);
      const dy = r.top + r.height / 2 - (f.y + f.h / 2);
      const ix = Math.max(0, (f.w - r.width / s0) / 2);
      const iy = Math.max(0, (f.h - r.height / s0) / 2);
      thumb.style.visibility = 'hidden';
      gsap.fromTo(
        this.zoomer,
        { x: dx, y: dy, scale: s0, opacity: 1, clipPath: `inset(${iy}px ${ix}px)` },
        {
          x: 0,
          y: 0,
          scale: 1,
          clipPath: 'inset(0px 0px)',
          duration: 0.55,
          ease: 'expo.inOut',
          onComplete: () => this.zoomer.style.removeProperty('clip-path'),
        }
      );
    } else {
      gsap.fromTo(
        this.zoomer,
        { opacity: 0, scale: 0.94 },
        { opacity: 1, scale: 1, duration: 0.4, ease: 'power3.out' }
      );
    }

    this.updateChrome();
    this.preloadNeighbors();
    this.closeBtn.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.isOpen || this.closing) return;
    this.closing = true;
    if (this.pushedState) {
      this.pushedState = false;
      history.back();
    }

    const item = this.items[this.idx];
    const thumb = this.opts.getThumbEl(item?.id ?? '');
    const finish = () => {
      this.isOpen = false;
      this.closing = false;
      this.root.hidden = true;
      document.documentElement.classList.remove('lb-open');
      this.restoreThumb();
    };

    gsap.to(this.backdrop, { opacity: 0, duration: 0.4, ease: 'power2.inOut' });
    gsap.to(this.metaBar, { opacity: 0, duration: 0.2 });

    const r = thumb?.getBoundingClientRect();
    const visible =
      r && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    if (thumb && r && visible) {
      if (this.hiddenThumb !== thumb) {
        this.restoreThumb();
        this.hiddenThumb = thumb;
        thumb.style.visibility = 'hidden';
      }
      const f = this.fit;
      const s1 = Math.max(r.width / f.w, r.height / f.h);
      const dx = r.left + r.width / 2 - (f.x + f.w / 2);
      const dy = r.top + r.height / 2 - (f.y + f.h / 2);
      const ix = Math.max(0, (f.w - r.width / s1) / 2);
      const iy = Math.max(0, (f.h - r.height / s1) / 2);
      gsap.to(this.zoomer, {
        x: dx,
        y: dy,
        scale: s1,
        clipPath: `inset(${iy}px ${ix}px)`,
        duration: 0.45,
        ease: 'expo.inOut',
        onComplete: () => {
          this.zoomer.style.removeProperty('clip-path');
          finish();
        },
      });
    } else {
      gsap.to(this.zoomer, {
        opacity: 0,
        scale: 0.92,
        duration: 0.3,
        ease: 'power2.in',
        onComplete: finish,
      });
    }
  }

  private restoreThumb(): void {
    if (this.hiddenThumb) {
      this.hiddenThumb.style.removeProperty('visibility');
      this.hiddenThumb = null;
    }
  }

  // ------------------------------------------------------------- navigation

  private step(dir: number): void {
    if (this.items.length < 2) return;
    this.goTo((this.idx + dir + this.items.length) % this.items.length, dir);
  }

  private goTo(newIdx: number, dir: number): void {
    if (newIdx === this.idx) return;
    this.restoreThumb();
    gsap.to(this.zoomer, {
      x: this.tx - dir * 90,
      opacity: 0,
      duration: 0.2,
      ease: 'power2.in',
      onComplete: () => {
        this.idx = newIdx;
        const item = this.items[newIdx];
        this.setItem(item);
        this.resetTransform();
        const thumb = this.opts.getThumbEl(item.id);
        if (thumb) {
          this.hiddenThumb = thumb;
          thumb.style.visibility = 'hidden';
        }
        if (this.pushedState) {
          history.replaceState({ pkLightbox: true }, '', `#p-${item.id}`);
        }
        gsap.fromTo(
          this.zoomer,
          { x: dir * 90, opacity: 0 },
          { x: 0, opacity: 1, duration: 0.32, ease: 'power3.out' }
        );
        this.preloadNeighbors();
      },
    });
  }

  private preloadNeighbors(): void {
    for (const d of [1, -1]) {
      const it = this.items[(this.idx + d + this.items.length) % this.items.length];
      if (it) new Image().src = it.full;
    }
  }

  // ----------------------------------------------------------------- content

  private setItem(item: LightboxItem): void {
    this.computeFit(item);
    Object.assign(this.zoomer.style, {
      left: `${this.fit.x}px`,
      top: `${this.fit.y}px`,
      width: `${this.fit.w}px`,
      height: `${this.fit.h}px`,
      backgroundColor: item.color,
    });
    this.imgLo.src = item.thumb;
    this.imgLo.alt = item.caption || 'Photo';

    const token = ++this.hiToken;
    this.imgHi.style.opacity = '0';
    this.imgHi.src = item.full;
    this.imgHi
      .decode()
      .then(() => {
        if (token === this.hiToken) {
          gsap.to(this.imgHi, { opacity: 1, duration: 0.25, ease: 'power1.out' });
        }
      })
      .catch(() => {
        if (token === this.hiToken) this.imgHi.style.opacity = '1';
      });

    this.captionEl.textContent = item.caption;
    this.tagsEl.textContent = item.tags.join('  ·  ');
    this.countEl.textContent = `${this.idx + 1} / ${this.items.length}`;
  }

  private computeFit(item: LightboxItem): void {
    const vw = innerWidth;
    const vh = innerHeight;
    const scale = Math.min(vw / item.width, vh / item.height);
    const w = item.width * scale;
    const h = item.height * scale;
    this.fit = { x: (vw - w) / 2, y: (vh - h) / 2, w, h };
  }

  // --------------------------------------------------------------- transform

  private resetTransform(): void {
    this.s = 1;
    this.tx = 0;
    this.ty = 0;
    gsap.set(this.zoomer, { x: 0, y: 0, scale: 1, opacity: 1 });
    this.updateChrome();
  }

  private apply(animate: boolean): void {
    const target = { x: this.tx, y: this.ty, scale: this.s };
    if (animate) {
      gsap.to(this.zoomer, { ...target, duration: 0.35, ease: 'power3.out', overwrite: 'auto' });
    } else {
      gsap.set(this.zoomer, target);
    }
    this.updateChrome();
  }

  private clampPan(): void {
    const maxX = Math.max(0, (this.fit.w * this.s - innerWidth) / 2);
    const maxY = Math.max(0, (this.fit.h * this.s - innerHeight) / 2);
    this.tx = Math.min(maxX, Math.max(-maxX, this.tx));
    this.ty = Math.min(maxY, Math.max(-maxY, this.ty));
  }

  /** Zoom to `ns`, keeping the viewport point (px, py) fixed on the image. */
  private setScale(ns: number, px: number, py: number, animate: boolean): void {
    ns = Math.min(MAX_SCALE, Math.max(1, ns));
    const cx = this.fit.x + this.fit.w / 2;
    const cy = this.fit.y + this.fit.h / 2;
    if (ns === 1) {
      this.tx = 0;
      this.ty = 0;
    } else {
      this.tx = px - cx - (px - cx - this.tx) * (ns / this.s);
      this.ty = py - cy - (py - cy - this.ty) * (ns / this.s);
    }
    this.s = ns;
    this.clampPan();
    this.apply(animate);
  }

  private toggleZoom(px: number, py: number): void {
    this.setScale(this.s > 1.05 ? 1 : 2.5, px, py, true);
  }

  private updateChrome(): void {
    this.root.classList.toggle('lb-zoomed', this.s > 1.05);
  }

  // ---------------------------------------------------------------- gestures

  private onWheel = (e: WheelEvent): void => {
    if (!this.isOpen) return;
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0022);
    this.setScale(this.s * factor, e.clientX, e.clientY, true);
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.isOpen || this.closing) return;
    this.stage.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.gesture = {
        type: 'pinch',
        d0: Math.hypot(a.x - b.x, a.y - b.y),
        mx0: (a.x + b.x) / 2,
        my0: (a.y + b.y) / 2,
        s0: this.s,
        tx0: this.tx,
        ty0: this.ty,
      };
    } else if (this.pointers.size === 1) {
      this.gesture =
        this.s > 1.05
          ? { type: 'pan', x0: e.clientX, y0: e.clientY, tx0: this.tx, ty0: this.ty }
          : { type: 'pending', x0: e.clientX, y0: e.clientY };
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.gesture || !this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = this.gesture;

    if (g.type === 'pinch') {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const ns = Math.min(MAX_SCALE, Math.max(1, g.s0 * (d / Math.max(1, g.d0))));
      const cx = this.fit.x + this.fit.w / 2;
      const cy = this.fit.y + this.fit.h / 2;
      this.tx = mx - cx - (g.mx0 - cx - g.tx0) * (ns / g.s0);
      this.ty = my - cy - (g.my0 - cy - g.ty0) * (ns / g.s0);
      this.s = ns;
      this.clampPan();
      this.apply(false);
      return;
    }

    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;

    if (g.type === 'pending') {
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) {
        this.gesture = { type: 'swipe', x0: g.x0, y0: g.y0, lastX: e.clientX, lastT: e.timeStamp, vx: 0 };
      } else if (Math.abs(dy) > 12) {
        this.gesture = { type: 'dismiss', x0: g.x0, y0: g.y0 };
        this.root.classList.add('lb-dragging');
      }
      return;
    }

    if (g.type === 'pan') {
      this.tx = g.tx0 + dx;
      this.ty = g.ty0 + dy;
      this.clampPan();
      this.apply(false);
    } else if (g.type === 'swipe') {
      const dt = Math.max(1, e.timeStamp - g.lastT);
      g.vx = (e.clientX - g.lastX) / dt;
      g.lastX = e.clientX;
      g.lastT = e.timeStamp;
      const resist = this.items.length < 2 ? 0.3 : 0.95;
      gsap.set(this.zoomer, { x: dx * resist });
    } else if (g.type === 'dismiss') {
      const p = Math.min(1, Math.abs(dy) / 400);
      gsap.set(this.zoomer, { x: dx * 0.4, y: dy, scale: 1 - p * 0.12 });
      gsap.set(this.backdrop, { opacity: 1 - p * 0.7 });
      gsap.set(this.metaBar, { opacity: 1 - p * 2 });
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (!g) return;

    if (g.type === 'pinch') {
      this.gesture = null;
      if (this.s < 1.02) this.setScale(1, 0, 0, true);
      return;
    }
    if (this.pointers.size > 0) return;
    this.gesture = null;

    if (g.type === 'pending') {
      // A tap. Double-tap toggles zoom; single tap outside the image closes.
      const now = e.timeStamp;
      if (now - this.lastTap < 300) {
        this.lastTap = 0;
        this.toggleZoom(e.clientX, e.clientY);
      } else {
        this.lastTap = now;
        const f = this.fit;
        const inside =
          e.clientX >= f.x + this.tx &&
          e.clientX <= f.x + f.w + this.tx &&
          e.clientY >= f.y + this.ty &&
          e.clientY <= f.y + f.h + this.ty;
        if (!inside && e.pointerType !== 'touch') this.close();
        else if (!inside) {
          setTimeout(() => {
            if (this.lastTap === now) this.close();
          }, 300);
        }
      }
      return;
    }

    if (g.type === 'swipe') {
      const dx = (gsap.getProperty(this.zoomer, 'x') as number) || 0;
      const flung = Math.abs(g.vx) > 0.5;
      if ((Math.abs(dx) > SWIPE_PX || flung) && this.items.length > 1) {
        this.step(dx < 0 || (flung && g.vx < 0) ? 1 : -1);
      } else {
        gsap.to(this.zoomer, { x: 0, duration: 0.3, ease: 'power3.out' });
      }
      return;
    }

    if (g.type === 'dismiss') {
      this.root.classList.remove('lb-dragging');
      const dy = (gsap.getProperty(this.zoomer, 'y') as number) || 0;
      if (Math.abs(dy) > DISMISS_PX) {
        this.close();
      } else {
        gsap.to(this.zoomer, { x: 0, y: 0, scale: 1, duration: 0.35, ease: 'power3.out' });
        gsap.to(this.backdrop, { opacity: 1, duration: 0.3 });
        gsap.to(this.metaBar, { opacity: 1, duration: 0.3 });
      }
    }
  };

  private onKey = (e: KeyboardEvent): void => {
    if (!this.isOpen || this.closing) return;
    if (e.key === 'Escape') this.close();
    else if (e.key === 'ArrowRight') this.step(1);
    else if (e.key === 'ArrowLeft') this.step(-1);
    else if (e.key === '+' || e.key === '=') this.setScale(this.s * 1.4, innerWidth / 2, innerHeight / 2, true);
    else if (e.key === '-') this.setScale(this.s / 1.4, innerWidth / 2, innerHeight / 2, true);
    else if (e.key === '0') this.setScale(1, 0, 0, true);
  };

  private onResize = (): void => {
    if (!this.isOpen) return;
    const item = this.items[this.idx];
    if (!item) return;
    this.computeFit(item);
    Object.assign(this.zoomer.style, {
      left: `${this.fit.x}px`,
      top: `${this.fit.y}px`,
      width: `${this.fit.w}px`,
      height: `${this.fit.h}px`,
    });
    this.resetTransform();
  };
}
