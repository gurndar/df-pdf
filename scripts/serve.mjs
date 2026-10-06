// Minimal static server for app/ (no dependencies).
import http from "http";
import fs from "fs";
import path from "path";

const root = path.resolve("app");
const port = Number(process.env.PORT) || 8080;
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };

export function serve(p = port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    let file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404).end(); return; }
      res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(p, () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await serve();
  console.log(`http://localhost:${port}`);
}
