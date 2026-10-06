# Experiment 01: whole-file vs range loading memory

## Background
On a 4GB Chromebook, opening an ~800MB, 1,081-page digital textbook in the Gallery app or Chrome
freezes the whole system right after the double-click. Hypothesis: the viewers **load the entire
file into memory**.

## Method
- `gen.py`: builds a 795MB, 1,081-page PDF with one incompressible RGB image (~735KB) per page
  (`--outline` adds chapter and section bookmarks)
- `measure.mjs`: pdf.js in Node opens pages 1, 540 and 1081 and runs `getOperatorList` (which
  decodes the images), then reports peak RSS
  - `whole`: reads the whole file and calls `getDocument({ data })`
  - `range`: `PDFDataRangeTransport` reads only the 64KB chunks requested (`disableAutoFetch`, `disableStream`)

```sh
python3 gen.py 1081 big.pdf
npm i pdfjs-dist@4
node measure.mjs whole big.pdf
node measure.mjs range big.pdf
```

## Results (cloud container, Node 22, pdfjs-dist 4)

|                                   | whole    | range  |
|-----------------------------------|----------|--------|
| Peak memory (VmHWM)               | 1,610MB  | 324MB  |
| Minus Node + pdf.js baseline (84MB) | ~1,530MB | ~240MB |
| Time to open                      | 5–10s    | ~1s    |
| Bytes read from disk              | 795MB    | 73MB   |

## Conclusions and caveats
- Whole-file loading puts about 2× the file size in memory, which matches the OOM and zram
  thrashing seen on 4GB devices
- With range loading, memory scales with the pages that are open, not with the file size
- Caveats: no canvas rendering, not a real textbook (no JPEGs), much faster CPU than a Chromebook
- Why `range` read 73MB: with a flat page tree, pdf.js checks the earlier page objects one by one to
  find page N (1,090 requests × 64KB). No memory impact, but room to optimize I/O
