// Render the SVG icons to the PNG sizes the web app manifest needs.
//   npm run icons
import fs from "fs";
import path from "path";
import { chromium, executablePath } from "./browser.mjs";

const browser = await chromium.launch({ executablePath });
const page = await browser.newPage();
const jobs = [["icon.svg", "icon-192.png", 192], ["icon.svg", "icon-512.png", 512], ["maskable.svg", "maskable-512.png", 512]];
for (const [src, out, size] of jobs) {
  const svg = fs.readFileSync(path.join("app/icons", src), "utf8");
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>*{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: path.join("app/icons", out), omitBackground: true });
}
await browser.close();
console.log("icons rendered");
