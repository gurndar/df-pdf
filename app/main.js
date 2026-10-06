import { GlobalWorkerOptions, getDocument } from "./vendor/pdf.min.mjs";
import { FileRangeTransport } from "./file-range-transport.js";
import { Viewer, MAX_CANVAS_PIXELS } from "./viewer.js";

GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.mjs";

const $ = (id) => document.getElementById(id);
const viewerEl = $("viewer");
// ?mode=whole loads the entire file like ordinary viewers do (for benchmarks).
const mode = new URLSearchParams(location.search).get("mode") === "whole" ? "whole" : "range";

let viewer = null;
let transport = null;

async function open(file) {
  if (viewer) await viewer.destroy();
  viewer = null;
  $("name").textContent = file.name;

  const common = {
    cMapUrl: "./vendor/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "./vendor/standard_fonts/",
    isEvalSupported: false,
    // Downscale oversized embedded images in the worker instead of decoding them at full size.
    canvasMaxAreaInBytes: MAX_CANVAS_PIXELS * 4,
  };
  let task;
  if (mode === "whole") {
    transport = null;
    task = getDocument({ ...common, data: new Uint8Array(await file.arrayBuffer()) });
  } else {
    transport = new FileRangeTransport(file);
    task = getDocument({
      ...common,
      range: transport,
      length: file.size,
      rangeChunkSize: 64 * 1024,
      disableAutoFetch: true,
      disableStream: true,
    });
  }

  const doc = await task.promise;
  $("total").textContent = doc.numPages;
  $("page").max = doc.numPages;
  $("page").value = 1;
  $("goto").hidden = false;

  viewer = new Viewer(viewerEl, doc, { onPageChange: (n) => ($("page").value = n) });
  await viewer.init();
  viewerEl.focus();
  window.__reader.viewer = viewer;
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
  $("stats").textContent = parts.join(" · ");
}, 1000);

window.__reader = { mode, open, viewer: null, transport: () => transport };
