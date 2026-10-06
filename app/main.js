import { GlobalWorkerOptions, getDocument } from "./vendor/pdf.min.mjs";
import { FileRangeTransport } from "./file-range-transport.js";
import { Viewer, MAX_CANVAS_PIXELS } from "./viewer.js";

GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.mjs";

const $ = (id) => document.getElementById(id);
const viewerEl = $("viewer");
const params = new URLSearchParams(location.search);
// ?mode=whole loads the entire file like ordinary viewers do (for benchmarks).
const mode = params.get("mode") === "whole" ? "whole" : "range";
// pdf.js never frees chunks it has read, so once this many bytes have been read
// the document is reopened from scratch. ?budget=0 disables it (for benchmarks).
const READ_BUDGET = (params.has("budget") ? Number(params.get("budget")) : 192) * 1024 * 1024;

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

  const loaded = await load(file);
  const doc = loaded.doc;
  transport = loaded.transport;
  $("total").textContent = doc.numPages;
  $("page").max = doc.numPages;
  $("page").value = 1;
  $("goto").hidden = false;

  viewer = new Viewer(viewerEl, doc, {
    onPageChange: (n) => ($("page").value = n),
    onIdle: () => maybeRecycle().catch(showError),
  });
  await viewer.init();
  viewerEl.focus();
  window.__reader.viewer = viewer;
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

$("file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) open(file).catch(showError);
});

$("goto").addEventListener("submit", (e) => {
  e.preventDefault();
  viewer?.goto(Number($("page").value));
  viewerEl.focus();
});

viewerEl.addEventListener("keydown", (e) => {
  if (!viewer) return;
  const jumps = { Home: 1, End: viewer.doc.numPages };
  if (e.key in jumps) {
    e.preventDefault();
    viewer.goto(jumps[e.key]);
  }
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

function showError(err) {
  console.error(err);
  $("name").textContent = `열 수 없어요: ${err.message}`;
}

// Live memory readout (Chrome only exposes performance.memory).
const mb = (b) => `${Math.round(b / 1048576)}MB`;
setInterval(() => {
  if (!viewer) return;
  const parts = [];
  if (performance.memory) parts.push(`JS ${mb(performance.memory.usedJSHeapSize)}`);
  const c = viewer.liveCanvases();
  parts.push(`캔버스 ${c.count}개 ${mb(c.bytes)}`);
  if (transport) parts.push(`읽음 ${mb(transport.bytesRead)}`);
  if (recycleCount) parts.push(`재열기 ${recycleCount}회`);
  $("stats").textContent = parts.join(" · ");
}, 1000);

window.__reader = { mode, open, viewer: null, transport: () => transport, recycles: () => recycleCount };
