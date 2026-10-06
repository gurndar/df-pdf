import { GlobalWorkerOptions, getDocument } from "./vendor/pdf.min.mjs";
import { FileRangeTransport } from "./file-range-transport.js";
import { Viewer, MAX_CANVAS_PIXELS } from "./viewer.js";
import { loadOutline, renderOutline, resolveDest } from "./outline.js";
import { t, applyStrings } from "./i18n.js";

GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.mjs";
applyStrings();

const $ = (id) => document.getElementById(id);
const viewerEl = $("viewer");
const params = new URLSearchParams(location.search);
// ?mode=whole loads the entire file like ordinary viewers do (for benchmarks).
const mode = params.get("mode") === "whole" ? "whole" : "range";
// pdf.js never frees chunks it has read, so once this many bytes have been read
// the document is reopened from scratch. ?budget=0 disables it (for benchmarks).
const READ_BUDGET = (params.has("budget") ? Number(params.get("budget")) : 192) * 1024 * 1024;
const DEBUG = params.has("debug");
const ZOOM_STEP = 1.2;

let viewer = null;
let transport = null;
let currentFile = null;
let recycling = false;
let recycleCount = 0;

async function load(file) {
  const common = {
    cMapUrl: "./vendor/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "./vendor/standard_fonts/",
    isEvalSupported: false,
    // Downscale oversized embedded images in the worker instead of decoding them at full size.
    canvasMaxAreaInBytes: MAX_CANVAS_PIXELS * 4,
  };
  if (mode === "whole") {
    const doc = await getDocument({ ...common, data: new Uint8Array(await file.arrayBuffer()) }).promise;
    return { doc, transport: null };
  }
  const range = new FileRangeTransport(file);
  const doc = await getDocument({
    ...common,
    range,
    length: file.size,
    rangeChunkSize: 64 * 1024,
    disableAutoFetch: true,
    disableStream: true,
  }).promise;
  return { doc, transport: range };
}

async function open(file) {
  if (viewer) await viewer.destroy();
  viewer = null;
  currentFile = file;
  recycleCount = 0;
  $("name").textContent = file.name;
  document.title = `${file.name} – dF`;
  resetOutline();

  const loaded = await load(file);
  const doc = loaded.doc;
  transport = loaded.transport;
  $("total").textContent = doc.numPages;
  $("page").max = doc.numPages;
  $("page").value = 1;
  $("controls").hidden = false;

  const saved = readPosition(file);
  viewer = new Viewer(viewerEl, doc, {
    onPageChange: (n) => {
      $("page").value = n;
      savePosition(file, { page: n, zoom: viewer.zoom });
    },
    onIdle: () => maybeRecycle().catch(showError),
  });
  window.__reader.viewer = viewer;
  if (saved?.zoom) viewer.zoom = saved.zoom;
  await viewer.init();
  updateZoomLabel();
  if (saved?.page > 1 && saved.page <= doc.numPages) {
    viewer.goto(saved.page);
    toast(t.resumed(saved.page));
  }
  viewerEl.focus();
  showOutline(doc).catch((e) => console.warn("outline", e));
}

async function maybeRecycle() {
  if (!transport || !READ_BUDGET || recycling || transport.bytesRead < READ_BUDGET) return;
  recycling = true;
  try {
    const file = currentFile;
    const loaded = await load(file);
    if (file !== currentFile || !viewer) {
      await loaded.doc.destroy();
      return;
    }
    await viewer.swapDocument(loaded.doc);
    transport = loaded.transport;
    recycleCount++;
  } finally {
    recycling = false;
  }
}

// ---- Table of contents ----

function resetOutline() {
  $("toc-list").replaceChildren();
  $("toc-empty").hidden = true;
  $("toc-btn").hidden = true;
}

async function showOutline(doc) {
  const file = currentFile;
  const items = await loadOutline(doc);
  if (file !== currentFile) return;
  renderOutline($("toc-list"), items, async (item) => {
    if (item.url) {
      window.open(item.url, "_blank", "noopener");
      return;
    }
    if (!item.dest || !viewer) return;
    const page = await resolveDest(() => viewer.doc, item.dest);
    if (page) {
      viewer.goto(page);
      if (matchMedia("(max-width: 700px)").matches) setTocOpen(false);
      viewerEl.focus();
    }
  });
  $("toc-empty").hidden = items.length > 0;
  $("toc-btn").hidden = false;
  setTocOpen(items.length > 0 && readPref("tocOpen", true) && !matchMedia("(max-width: 700px)").matches);
}

function setTocOpen(open) {
  $("toc").hidden = !open;
  $("toc-btn").setAttribute("aria-pressed", String(open));
}

$("toc-btn").addEventListener("click", () => {
  const open = $("toc").hidden;
  setTocOpen(open);
  writePref("tocOpen", open);
});

// ---- Zoom ----

function setZoom(zoom) {
  if (!viewer) return;
  viewer.setZoom(zoom);
  updateZoomLabel();
  savePosition(currentFile, { page: viewer.currentPage, zoom: viewer.zoom });
}

function updateZoomLabel() {
  $("zoom-reset").textContent = `${Math.round(viewer.zoom * 100)}%`;
}

$("zoom-in").addEventListener("click", () => setZoom(viewer.zoom * ZOOM_STEP));
$("zoom-out").addEventListener("click", () => setZoom(viewer.zoom / ZOOM_STEP));
$("zoom-reset").addEventListener("click", () => setZoom(1));

// Ctrl+wheel, which is also what a touchpad pinch sends.
viewerEl.addEventListener("wheel", (e) => {
  if (!e.ctrlKey || !viewer) return;
  e.preventDefault();
  clearTimeout(viewerEl.zoomTimer);
  viewerEl.pendingZoom = (viewerEl.pendingZoom ?? viewer.zoom) * Math.exp(-e.deltaY / 300);
  viewerEl.zoomTimer = setTimeout(() => {
    setZoom(viewerEl.pendingZoom);
    viewerEl.pendingZoom = null;
  }, 80);
}, { passive: false });

// ---- Navigation & keyboard ----

$("goto").addEventListener("submit", (e) => {
  e.preventDefault();
  viewer?.goto(Number($("page").value));
  viewerEl.focus();
});

document.addEventListener("keydown", (e) => {
  if (!viewer || e.target.matches("input")) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && (e.key === "+" || e.key === "=")) setZoom(viewer.zoom * ZOOM_STEP);
  else if (mod && e.key === "-") setZoom(viewer.zoom / ZOOM_STEP);
  else if (mod && e.key === "0") setZoom(1);
  else if (e.key === "Home") viewer.goto(1);
  else if (e.key === "End") viewer.goto(viewer.doc.numPages);
  else if (e.key === "ArrowLeft" && viewer.zoom <= 1) viewer.goto(viewer.currentPage - 1);
  else if (e.key === "ArrowRight" && viewer.zoom <= 1) viewer.goto(viewer.currentPage + 1);
  else return;
  e.preventDefault();
});

// ---- Opening files ----

$("file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (file) open(file).catch(showError);
});

viewerEl.addEventListener("dragover", (e) => {
  e.preventDefault();
  viewerEl.classList.add("drag");
});
viewerEl.addEventListener("dragleave", () => viewerEl.classList.remove("drag"));
viewerEl.addEventListener("drop", (e) => {
  e.preventDefault();
  viewerEl.classList.remove("drag");
  const file = e.dataTransfer.files[0];
  if (file) open(file).catch(showError);
});

// Installed app: PDFs opened from the Files app ("Open with") arrive here.
if ("launchQueue" in window) {
  window.launchQueue.setConsumer(async ({ files }) => {
    if (files?.length) open(await files[0].getFile()).catch(showError);
  });
}

function showError(err) {
  console.error(err);
  $("name").textContent = `${t.cantOpen}: ${err.message}`;
}

// ---- Persistence (best effort; storage can be unavailable) ----

const POSITIONS_KEY = "df:positions";
const MAX_POSITIONS = 100;
// The app used to be called "Feather PDF"; carry its saved state over once.
try {
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith("feather:")) continue;
    const renamed = `df:${key.slice("feather:".length)}`;
    if (localStorage.getItem(renamed) === null) localStorage.setItem(renamed, localStorage.getItem(key));
    localStorage.removeItem(key);
  }
} catch {}

const fileKey = (f) => `${f.name}|${f.size}|${f.lastModified}`;

function readJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function readPosition(file) {
  return readJSON(POSITIONS_KEY, {})[fileKey(file)] ?? null;
}

let saveTimer = null;
function savePosition(file, pos) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const all = readJSON(POSITIONS_KEY, {});
    delete all[fileKey(file)];
    all[fileKey(file)] = { ...pos, at: Date.now() };
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_POSITIONS))) delete all[k];
    writeJSON(POSITIONS_KEY, all);
  }, 500);
}

const readPref = (name, fallback) => readJSON(`df:${name}`, fallback);
const writePref = (name, value) => writeJSON(`df:${name}`, value);

// ---- Misc ----

let toastTimer = null;
function toast(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 2500);
}

// Live memory readout for testing on real devices: add ?debug to the URL.
if (DEBUG) {
  $("stats").hidden = false;
  const mb = (b) => `${Math.round(b / 1048576)}MB`;
  setInterval(() => {
    if (!viewer) return;
    const parts = [];
    if (performance.memory) parts.push(`JS ${mb(performance.memory.usedJSHeapSize)}`);
    const c = viewer.liveCanvases();
    parts.push(`canvas ${c.count} ${mb(c.bytes)}`);
    if (transport) parts.push(`read ${mb(transport.bytesRead)}`);
    if (recycleCount) parts.push(`reopened ${recycleCount}`);
    $("stats").textContent = parts.join(" · ");
  }, 1000);
}

// Offline support + installability. Skipped on localhost (unless ?sw) so
// development always serves fresh files.
const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);
if ("serviceWorker" in navigator && (!isLocal || params.has("sw"))) {
  navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("sw", e));
}

window.__reader = { mode, open, viewer: null, transport: () => transport, recycles: () => recycleCount };
