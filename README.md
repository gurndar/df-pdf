# dF — Feather and Differentiation PDF

<img src="app/icons/icon-192.png" width="72" alt="dF icon" align="right">

*Feather* because it is light. *Differentiation* because it is different from every other viewer that
freezes on big files. And *dF* is how you write the differential of F.

dF is a lightweight PDF reader that opens **huge PDFs on low-memory Chromebooks without freezing**,
like a 1,000-page, 800MB textbook on a 4GB Chromebook.

**Use it now: https://gurndar.github.io/df-pdf/**. Nothing to install, and it works on
school-managed Chromebooks. Your PDF is read from your own disk and never uploaded anywhere.

## Why
ChromeOS's Gallery app and Chrome's built-in viewer load the whole PDF into memory. With an 800MB
file that means 1GB+ at once, and a 4GB Chromebook locks up hard enough to need a forced shutdown.
dF reads only the parts of the file it needs, so memory stays at a few hundred MB no matter how
big the PDF is. See [experiments/01-load-memory](experiments/01-load-memory/README.md).

## Features
- Opens multi-hundred-MB PDFs without loading them into memory
- Table of contents sidebar (from the PDF's bookmarks)
- Remembers the page you were on, per file
- Zoom: buttons, Ctrl `+` / `-` / `0`, Ctrl+scroll or touchpad pinch
- Keyboard: ← / → previous / next page, Home / End, type a page number to jump
- Installable app (PWA), works offline
- **Opens from the Files app**: after installing, right-click a PDF → *Open with* → dF
  (you can also make it the default for PDFs)
- English and Korean UI (follows the browser language)

## How it stays light
- **Range reads**: `File.slice()` feeds pdf.js only the 64KB chunks it asks for (`app/file-range-transport.js`)
- **Virtualized pages**: only the visible pages ±1 have DOM and canvases (`app/viewer.js`)
- **One render at a time**, nothing renders while you're scrolling fast
- **Capped canvases**: at most 4M pixels (16MB) per page, freed as soon as the page leaves the screen
- **Downscaled images**: oversized embedded images are shrunk in the worker (`canvasMaxAreaInBytes`)
- **Reopen after a read budget**: pdf.js keeps every chunk it has read for the life of the document.
  After 192MB of reads, dF opens a fresh pdf.js instance for the same file, keeps the pages on
  screen, and destroys the old instance and its worker

## Development
```sh
npm install      # copies pdf.js into app/vendor
npm start        # http://localhost:8080  (add ?debug to show live memory stats)
```
The app is plain static files in `app/`. Pushing to the default branch deploys it to GitHub Pages
(`.github/workflows/pages.yml`).

Tests and benchmarks run in real Chromium through Playwright:
```sh
python3 experiments/01-load-memory/gen.py 1081 toc.pdf --outline   # 795MB test PDF with bookmarks
npm test -- toc.pdf                                  # end-to-end feature checks
npm run bench -- toc.pdf range range-nobudget whole  # peak memory; range:<MB> sets the budget
```

## Benchmark
795MB, 1,081 pages, 1366×768 window. Memory is PSS summed over all Chromium processes and includes
the browser's own ~276MB. Each cell shows peak / after the step.

| Step | dF | dF, no reopen | Whole-file loading (typical viewer) |
|---|---|---|---|
| Open + page 1 | 1.9s · 468 / 480MB | 2.4s · 451 / 451MB | 2.3s · 1,102 / 1,104MB |
| Jump to 540 → 1081 | 0.1s · 513 / 502MB | 0.1s · 472 / 472MB | 0.1s · 1,116 / 1,123MB |
| Fast scroll 4s | 502 / 493MB | 517 / 516MB | 1,168 / 1,168MB |
| Read 500 pages in a row | 769 / **610MB** (2 reopens) | 843 / **843MB** | 1,203 / 1,166MB |

- Without reopening, memory grows with everything read, up to the file size. Reopening keeps it near the budget.
- The 500-page peak comes from an extreme test that flips about 25 pages per second. Memory from
  canvases and workers that were already freed gets reclaimed late. Lowering the budget to 64 or 96MB
  doesn't change it (730–750MB).
- A budget that is too low (64MB) causes 40 reopens and gets slower. With a flat page tree, finding
  page N after reopening alone reads tens of MB.

## Known limitations
- Reopening is a workaround. The real fix is an engine that doesn't keep chunks, such as PDFium
  (WASM) with synchronous file reads.
- All pages are laid out at page 1's size. Pages of other sizes are fitted inside that slot.
- No text search, text selection or in-page links yet.

## License
[MIT](LICENSE). dF bundles [pdf.js](https://github.com/mozilla/pdf.js) (Apache License 2.0) at
build time; its files in `app/vendor/` keep their own license.
