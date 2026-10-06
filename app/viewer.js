// Virtualized, memory-bounded PDF viewer.
//
// Memory rules:
//  - only pages in the viewport (plus one on each side) have DOM/canvas
//  - at most one page renders at a time, and nothing renders while scrolling
//  - canvases are capped at MAX_CANVAS_PIXELS; pages are released as soon as
//    they leave the window (canvas zeroed, pdf.js page caches cleaned up)
import { RenderingCancelledException } from "./vendor/pdf.min.mjs";

const GAP = 12;
const OVERSCAN = 1;
const SCROLL_IDLE_MS = 120;
export const MAX_CANVAS_PIXELS = 4 * 1024 * 1024; // 16MB of RGBA per page

export class Viewer {
  constructor(container, doc, { onPageChange } = {}) {
    this.container = container;
    this.doc = doc;
    this.onPageChange = onPageChange;
    this.slots = new Map(); // pageNum -> { el, canvas, task, rendered }
    this.queue = [];
    this.rendering = false;
    this.releasedSinceCleanup = 0;
    this.currentPage = 1;

    this.spacer = document.createElement("div");
    this.spacer.className = "spacer";
    container.replaceChildren(this.spacer);

    this.onScroll = this.onScroll.bind(this);
    container.addEventListener("scroll", this.onScroll, { passive: true });
    this.resizeObserver = new ResizeObserver(() => this.layout());
  }

  async init() {
    // Size every slot from page 1 instead of loading all pages up front.
    const first = await this.doc.getPage(1);
    const vp = first.getViewport({ scale: 1 });
    this.pageRatio = vp.height / vp.width;
    first.cleanup();
    this.layout();
    this.resizeObserver.observe(this.container);
  }

  layout() {
    const width = Math.min(this.container.clientWidth - 2 * GAP, 1000);
    if (width <= 0 || width === this.slotW) return;
    const page = this.currentPage;
    this.slotW = width;
    this.slotH = Math.round(width * this.pageRatio);
    this.spacer.style.height = `${this.doc.numPages * (this.slotH + GAP) + GAP}px`;
    for (const n of [...this.slots.keys()]) this.release(n);
    this.goto(page);
  }

  pageTop(n) {
    return GAP + (n - 1) * (this.slotH + GAP);
  }

  goto(n) {
    n = Math.max(1, Math.min(this.doc.numPages, n));
    this.container.scrollTop = this.pageTop(n) - GAP;
    this.update();
  }

  onScroll() {
    this.trackCurrentPage();
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.update(), SCROLL_IDLE_MS);
  }

  trackCurrentPage() {
    const mid = this.container.scrollTop + this.container.clientHeight / 2;
    const n = Math.min(this.doc.numPages, Math.max(1, Math.floor(mid / (this.slotH + GAP)) + 1));
    if (n !== this.currentPage) {
      this.currentPage = n;
      this.onPageChange?.(n);
    }
  }

  visibleRange() {
    const step = this.slotH + GAP;
    const top = this.container.scrollTop;
    const first = Math.max(1, Math.floor(top / step) + 1);
    const last = Math.min(this.doc.numPages, Math.floor((top + this.container.clientHeight) / step) + 1);
    return [first, last];
  }

  update() {
    this.trackCurrentPage();
    const [first, last] = this.visibleRange();
    const lo = Math.max(1, first - OVERSCAN);
    const hi = Math.min(this.doc.numPages, last + OVERSCAN);

    for (const n of [...this.slots.keys()]) {
      if (n < lo || n > hi) this.release(n);
    }

    // Visible pages first, then the overscan neighbours.
    const order = [];
    for (let n = first; n <= last; n++) order.push(n);
    for (let n = lo; n < first; n++) order.push(n);
    for (let n = last + 1; n <= hi; n++) order.push(n);

    for (const n of order) if (!this.slots.has(n)) this.createSlot(n);
    this.queue = order.filter((n) => !this.slots.get(n).rendered);
    this.pump();
  }

  createSlot(n) {
    const el = document.createElement("div");
    el.className = "page";
    el.style.top = `${this.pageTop(n)}px`;
    el.style.width = `${this.slotW}px`;
    el.style.height = `${this.slotH}px`;
    el.dataset.page = n;
    this.spacer.append(el);
    this.slots.set(n, { el, canvas: null, task: null, rendered: false });
  }

  release(n) {
    const slot = this.slots.get(n);
    if (!slot) return;
    slot.task?.cancel();
    if (slot.canvas) {
      // Zeroing the size frees the backing store immediately.
      slot.canvas.width = slot.canvas.height = 0;
    }
    slot.el.remove();
    this.slots.delete(n);
    this.releasedSinceCleanup++;
  }

  async pump() {
    if (this.rendering) return;
    this.rendering = true;
    try {
      while (this.queue.length) {
        const n = this.queue.shift();
        const slot = this.slots.get(n);
        if (!slot || slot.rendered) continue;
        await this.renderPage(n, slot);
      }
      if (this.releasedSinceCleanup > 20) {
        this.releasedSinceCleanup = 0;
        await this.doc.cleanup(true).catch(() => {});
      }
    } finally {
      this.rendering = false;
    }
  }

  async renderPage(n, slot) {
    const page = await this.doc.getPage(n);
    try {
      if (this.slots.get(n) !== slot) return; // released while loading
      const base = page.getViewport({ scale: 1 });
      // Fit the slot (pages may differ in size from page 1).
      const cssScale = Math.min(this.slotW / base.width, this.slotH / base.height);
      const cssW = base.width * cssScale;
      const cssH = base.height * cssScale;
      const dpr = window.devicePixelRatio || 1;
      const outScale = Math.min(dpr, Math.sqrt(MAX_CANVAS_PIXELS / (cssW * cssH)));
      const viewport = page.getViewport({ scale: cssScale * outScale });

      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;

      slot.task = page.render({ canvasContext: canvas.getContext("2d", { alpha: false }), viewport });
      await slot.task.promise;
      slot.task = null;
      if (this.slots.get(n) !== slot) {
        canvas.width = canvas.height = 0;
        return;
      }
      slot.canvas = canvas;
      slot.rendered = true;
      slot.el.append(canvas);
    } catch (e) {
      if (!(e instanceof RenderingCancelledException)) console.error(`page ${n}`, e);
    } finally {
      page.cleanup();
    }
  }

  liveCanvases() {
    let count = 0, pixels = 0;
    for (const s of this.slots.values()) {
      if (s.canvas) { count++; pixels += s.canvas.width * s.canvas.height; }
    }
    return { count, bytes: pixels * 4 };
  }

  async destroy() {
    clearTimeout(this.idleTimer);
    this.resizeObserver.disconnect();
    this.container.removeEventListener("scroll", this.onScroll);
    for (const n of [...this.slots.keys()]) this.release(n);
    await this.doc.destroy();
  }
}
