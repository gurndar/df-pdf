// Virtualized, memory-bounded PDF viewer.
//
// Memory rules:
//  - only pages in the viewport (plus one on each side) have DOM/canvas
//  - at most one page renders at a time, and nothing renders while scrolling
//  - canvases are capped at MAX_CANVAS_PIXELS; pages are released as soon as
//    they leave the window (canvas zeroed, pdf.js page caches cleaned up)
//  - text and link layers exist only for those same on-screen pages
import { RenderingCancelledException } from "./vendor/pdf.min.mjs";
import { buildLinkLayer, buildTextLayer } from "./page-layers.js";

const GAP = 12;
const OVERSCAN = 1;
const SCROLL_IDLE_MS = 120;
const MAX_FIT_WIDTH = 1000;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 3;
export const MAX_CANVAS_PIXELS = 4 * 1024 * 1024; // 16MB of RGBA per page

export class Viewer {
  // nav: { goToDest(dest), goToPage(n), currentPage() } for links inside the PDF
  constructor(container, doc, { onPageChange, onIdle, nav } = {}) {
    this.container = container;
    this.doc = doc;
    this.onPageChange = onPageChange;
    this.onIdle = onIdle;
    this.nav = nav;
    this.slots = new Map(); // pageNum -> { el, canvas, task, textLayer, rendered, layersReady }
    this.queue = [];
    this.rendering = null; // promise of the running pump, if any
    this.releasedSinceCleanup = 0;
    this.currentPage = 1;
    this.zoom = 1;

    this.spacer = document.createElement("div");
    this.spacer.className = "spacer";
    container.replaceChildren(this.spacer);

    this.onScroll = this.onScroll.bind(this);
    container.addEventListener("scroll", this.onScroll, { passive: true });
    this.resizeObserver = new ResizeObserver(() => this.layout());

    // While dragging a selection, stretch the text layer's end marker so the
    // selection doesn't jump to the end of the page (same trick as pdf.js).
    this.onMouseDown = (e) => e.target.closest?.(".textLayer")?.classList.add("selecting");
    this.onMouseUp = () => {
      for (const el of container.querySelectorAll(".textLayer.selecting")) el.classList.remove("selecting");
    };
    container.addEventListener("mousedown", this.onMouseDown);
    document.addEventListener("mouseup", this.onMouseUp);
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

  // Zoom 1 fits the page to the window width (capped at MAX_FIT_WIDTH).
  setZoom(zoom) {
    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(zoom * 100) / 100));
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    this.layout();
  }

  layout() {
    const viewW = this.container.clientWidth;
    const fit = Math.min(viewW - 2 * GAP, MAX_FIT_WIDTH);
    if (fit <= 0) return;
    const width = Math.round(fit * this.zoom);
    const spacerW = Math.max(viewW, width + 2 * GAP);
    if (width === this.slotW && spacerW === this.spacerW) return;

    // Keep the same spot of the document in view across the relayout.
    const c = this.container;
    const pos = this.slotH ? c.scrollTop / (this.slotH + GAP) : 0;
    const xFrac = this.spacerW ? (c.scrollLeft + c.clientWidth / 2) / this.spacerW : 0.5;

    for (const n of [...this.slots.keys()]) this.release(n);
    this.slotW = width;
    this.slotH = Math.round(width * this.pageRatio);
    this.spacerW = spacerW;
    this.slotLeft = Math.round((spacerW - width) / 2);
    this.spacer.style.width = `${spacerW}px`;
    this.spacer.style.height = `${this.doc.numPages * (this.slotH + GAP) + GAP}px`;
    c.scrollTop = pos * (this.slotH + GAP);
    c.scrollLeft = xFrac * spacerW - c.clientWidth / 2;
    this.update();
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
    el.style.left = `${this.slotLeft}px`;
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
    slot.textLayer?.cancel();
    if (slot.canvas) {
      // Zeroing the size frees the backing store immediately.
      slot.canvas.width = slot.canvas.height = 0;
    }
    slot.el.remove();
    this.slots.delete(n);
    this.releasedSinceCleanup++;
  }

  pump() {
    this.rendering ??= this.drain()
      .catch((e) => console.error(e))
      .finally(() => {
        this.rendering = null;
        this.onIdle?.();
      });
    return this.rendering;
  }

  async drain() {
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
  }

  // Replace the document (same file, fresh pdf.js instance) without touching
  // canvases already on screen. The old instance and its worker are destroyed,
  // which frees every chunk it had read.
  async swapDocument(doc) {
    while (this.rendering) await this.rendering;
    const old = this.doc;
    this.doc = doc;
    this.releasedSinceCleanup = 0;
    await old.destroy();
    this.update();
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
      const content = document.createElement("div");
      content.className = "page-content";
      content.style.width = `${cssW}px`;
      content.style.height = `${cssH}px`;
      content.append(canvas);
      slot.el.append(content);

      // Picture first, then the (cheap) text and link overlays.
      const cssViewport = page.getViewport({ scale: cssScale });
      const text = await buildTextLayer(page, cssViewport, content);
      slot.textLayer = text.layer;
      await Promise.all([text.done, this.nav && buildLinkLayer(page, cssViewport, content, this.nav)]);
      slot.textLayer = null;
      slot.layersReady = true;
    } catch (e) {
      if (!(e instanceof RenderingCancelledException) && e?.name !== "AbortException") {
        console.error(`page ${n}`, e);
      }
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
    this.container.removeEventListener("mousedown", this.onMouseDown);
    document.removeEventListener("mouseup", this.onMouseUp);
    for (const n of [...this.slots.keys()]) this.release(n);
    await this.doc.destroy();
  }
}
