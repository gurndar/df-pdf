# Contributing to dF

Thanks for helping! dF exists for one reason: **huge PDFs should open on low-memory Chromebooks
without freezing them.** Every change is judged against that.

## Ground rules
1. **Never load the whole file.** PDF bytes come only through `FileRangeTransport`
   (`app/file-range-transport.js`). Anything that needs every page, such as full-text search or
   thumbnails for all pages, needs a design that keeps memory bounded. Please open an issue to
   discuss it first.
2. **Work only on on-screen pages.** Canvases, text layers and link layers exist only for the visible
   pages ±1 and are released when a page scrolls away. New per-page features should follow
   `Viewer.renderPage` / `Viewer.release`.
3. **No build step, no new runtime dependencies.** The app is plain ES modules in `app/` plus pdf.js.
   That keeps it easy to audit, cache offline, and host anywhere.
4. **Files stay on the device.** No uploads, analytics or third-party requests.

## Setup
```sh
npm install                 # also copies pdf.js into app/vendor
npm start                   # http://localhost:8080  (?debug shows live memory stats)
```
Requires Node 22+ and Python 3 (for generating test PDFs).

## Project layout
| Path | What |
|---|---|
| `app/main.js` | App shell: opening files, TOC, zoom, keyboard, saved positions, reopen-after-budget |
| `app/viewer.js` | Virtualized, memory-bounded page viewer |
| `app/page-layers.js` | Text selection layer and link layer for a page |
| `app/file-range-transport.js` | Feeds pdf.js byte ranges straight from the `File` |
| `app/outline.js` | Table of contents sidebar |
| `app/i18n.js` | UI strings (English and Korean) |
| `app/sw.js`, `app/manifest.webmanifest` | Offline support, install, "Open with" for PDFs |
| `bench/e2e.mjs` | End-to-end checks in real Chromium |
| `bench/browser-bench.mjs` | Peak memory benchmark |
| `experiments/` | Write-ups of the measurements behind the design |

## Tests
```sh
python3 experiments/01-load-memory/gen.py 1081 full.pdf --outline --links --small   # fast, ~1MB
npm test -- full.pdf
```
CI runs the same thing on every pull request. Add a check to `bench/e2e.mjs` for new behavior.

## Measuring memory
If your change touches loading, rendering or anything per page, include before/after numbers:
```sh
python3 experiments/01-load-memory/gen.py 1081 big.pdf --outline --links   # 795MB, realistic
npm run bench -- big.pdf range
```
Run the benchmark on `main` and on your branch with the same PDF, and paste both tables in the PR.

## UI text
Every string lives in `app/i18n.js` and needs English and Korean. If you can't write Korean, add the
English and say so in the PR; we'll fill it in. Translations for more languages are welcome.

## Releasing
Bump `VERSION` in `app/main.js` and `version` in `package.json`. The version names the offline
cache, so installed apps pick up the release. Merging to `main` deploys to GitHub Pages.

## Reporting bugs
Please use the issue templates. **Don't attach copyrighted PDFs** (e.g. textbooks). The file size,
page count and where it came from are usually enough, and we can generate a similar test file.
