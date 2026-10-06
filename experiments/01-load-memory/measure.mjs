import fs from "fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
const mode = process.argv[2], file = process.argv[3] || "big.pdf";
const mb = (k) => (k / 1024).toFixed(0) + "MB";
const hwm = () => { const s = fs.readFileSync("/proc/self/status", "utf8");
  return { rss: +s.match(/VmRSS:\s+(\d+)/)[1], peak: +s.match(/VmHWM:\s+(\d+)/)[1] }; };
const t0 = Date.now(); let bytesRead = 0, task;
if (mode === "whole") {
  const data = new Uint8Array(fs.readFileSync(file)); bytesRead = data.length;
  task = pdfjs.getDocument({ data });
} else {
  const fd = fs.openSync(file, "r"), length = fs.fstatSync(fd).size;
  class FileRange extends pdfjs.PDFDataRangeTransport {
    requestDataRange(begin, end) {
      if (process.env.LOG) console.error("req", begin, end-begin); const buf = Buffer.alloc(end - begin); fs.readSync(fd, buf, 0, end - begin, begin);
      bytesRead += end - begin; setTimeout(() => this.onDataRange(begin, new Uint8Array(buf)));
    }
  }
  task = pdfjs.getDocument({ range: new FileRange(length, null), length,
    disableAutoFetch: true, disableStream: true, rangeChunkSize: 65536 });
}
const doc = await task.promise;
const tOpen = Date.now() - t0;
for (const n of [1, 540, 1081]) { const p = await doc.getPage(n); await p.getOperatorList(); p.cleanup(); }
const m = hwm();
console.log(`${mode.padEnd(6)} pages=${doc.numPages} open=${tOpen}ms total=${Date.now()-t0}ms ` +
  `read=${(bytesRead/1e6).toFixed(1)}MB peakRSS=${mb(m.peak)} RSS=${mb(m.rss)}`);
process.exit(0);
