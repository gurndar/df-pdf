// README screenshots (light and dark) from the demo PDF.
//   python3 scripts/make-demo-pdf.py demo.pdf && node scripts/screenshots.mjs demo.pdf
import path from "path";
import { serve } from "./serve.mjs";
import { chromium, executablePath } from "./browser.mjs";

const file = path.resolve(process.argv[2] || "demo.pdf");
const port = 8093;
const server = await serve(port);
const browser = await chromium.launch({ executablePath });
for (const scheme of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: scheme, locale: "en-US" });
  await page.goto(`http://localhost:${port}/`);
  await page.setInputFiles("#file", file);
  await page.waitForSelector("#toc:not([hidden]) .toc-item");
  await page.click("#toc-list > li:nth-child(1) .toc-toggle");
  await page.click("#toc-list > li:nth-child(3) .toc-toggle");
  await page.click("text=3.2 The Second Law");
  await page.waitForFunction(() => window.__reader.viewer?.slots.get(7)?.layersReady);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `docs/screenshot-${scheme}.png` });
  await page.close();
}
await browser.close();
server.close();
console.log("docs/screenshot-{light,dark}.png");
