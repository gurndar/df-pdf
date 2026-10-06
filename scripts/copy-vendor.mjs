// Copy the pdf.js build into app/vendor so the app runs as plain static files.
import fs from "fs";
import path from "path";

const pkg = path.resolve("node_modules/pdfjs-dist");
const dst = path.resolve("app/vendor");
fs.mkdirSync(dst, { recursive: true });
for (const f of ["pdf.min.mjs", "pdf.worker.min.mjs"]) {
  fs.copyFileSync(path.join(pkg, "build", f), path.join(dst, f));
}
// pdf.js is Apache-2.0; ship its license next to its files.
fs.copyFileSync(path.join(pkg, "LICENSE"), path.join(dst, "LICENSE"));
for (const dir of ["cmaps", "standard_fonts"]) {
  fs.cpSync(path.join(pkg, dir), path.join(dst, dir), { recursive: true });
}
console.log("pdf.js copied to app/vendor");
