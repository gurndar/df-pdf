// End-to-end checks in real Chromium.
//   node bench/e2e.mjs path/to/with-outline.pdf [screenshot.png]
// The PDF should come from: python3 experiments/01-load-memory/gen.py 1081 toc.pdf --outline
import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import { serve } from "../scripts/serve.mjs";

const root = execSync("npm root -g").toString().trim();
const { chromium } = await import(path.join(root, "playwright", "index.mjs"));
const file = path.resolve(process.argv[2] || "toc.pdf");
const shot = process.argv[3];
const port = 8097;
const server = await serve(port);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: "en-US" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const rendered = (n) => page.waitForFunction((n) => window.__reader.viewer?.slots.get(n)?.rendered, n, { timeout: 30000 });
const current = () => page.evaluate(() => window.__reader.viewer.currentPage);

await page.goto(`http://localhost:${port}/?sw`);
check("English UI", (await page.textContent(".open-btn span")) === "Open PDF");

// Manifest & installability (Chromium's own checks). Needs a non-incognito profile.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "df-profile-"));
  const persistent = await chromium.launchPersistentContext(dir, {
    executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
  });
  const p = persistent.pages()[0] || (await persistent.newPage());
  await p.goto(`http://localhost:${port}/?sw`);
  await p.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 10000 }).catch(() => {});
  const cdp = await persistent.newCDPSession(p);
  const manifest = await cdp.send("Page.getAppManifest");
  check("manifest parses without errors", manifest.errors.length === 0, manifest.errors.map((e) => e.message).join("; "));
  const install = await cdp.send("Page.getInstallabilityErrors");
  check("installable", install.installabilityErrors.length === 0,
    install.installabilityErrors.map((e) => e.errorId).join(", "));
  await persistent.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

// Open + table of contents.
await page.setInputFiles("#file", file);
await rendered(1);
await page.waitForSelector("#toc:not([hidden]) .toc-item");
const chapters = await page.$$eval("#toc-list > li", (els) => els.length);
check("TOC shows chapters", chapters === 11, `${chapters} top-level entries`);

await page.click("text=Chapter 6");
await rendered(501);
check("TOC chapter jumps to its page", (await current()) === 501, `page ${await current()}`);

await page.click("#toc-list > li:nth-child(6) .toc-toggle");
await page.click("text=6.3 Section");
await rendered(551);
check("TOC nested section jumps", (await current()) === 551, `page ${await current()}`);

// Zoom keeps the reading position.
const widthBefore = await page.$eval('.page[data-page="551"]', (el) => el.offsetWidth);
await page.click("#zoom-in");
await rendered(551);
const widthAfter = await page.$eval('.page[data-page="551"]', (el) => el.offsetWidth);
check("zoom in grows the page", widthAfter > widthBefore * 1.15, `${widthBefore}px → ${widthAfter}px`);
check("zoom label", (await page.textContent("#zoom-reset")) === "120%");
check("zoom keeps position", Math.abs((await current()) - 551) <= 1, `page ${await current()}`);
await page.keyboard.press("Control+0");
check("Ctrl+0 resets zoom", (await page.textContent("#zoom-reset")) === "100%");

// Keyboard paging.
await page.click("#viewer");
await page.keyboard.press("ArrowRight");
await rendered(552);
check("ArrowRight goes to next page", (await current()) === 552);

if (shot) {
  await page.evaluate(() => window.__reader.viewer.goto(551));
  await rendered(551);
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot });
}

// Resume where we left off after reopening.
await page.waitForTimeout(700); // position is saved with a short debounce
await page.reload();
await page.setInputFiles("#file", file);
await page.waitForFunction(() => window.__reader.viewer?.currentPage > 1, null, { timeout: 30000 });
const resumed = await current();
check("resumes last page", Math.abs(resumed - 552) <= 1, `page ${resumed}`);
check("resume toast", (await page.textContent("#toast")).includes("Resumed"));
check("no page errors", errors.length === 0, errors.join(" | "));
await ctx.close();

// State saved under the old "Feather PDF" name is migrated.
{
  const c = await browser.newContext();
  const p = await c.newPage();
  await p.goto(`http://localhost:${port}/`);
  await p.evaluate(() => localStorage.setItem("feather:tocOpen", "false"));
  await p.reload();
  const migrated = await p.evaluate(() => [localStorage.getItem("df:tocOpen"), localStorage.getItem("feather:tocOpen")]);
  check("migrates old storage keys", migrated[0] === "false" && migrated[1] === null, JSON.stringify(migrated));
  await c.close();
}

// Korean locale.
const ko = await browser.newContext({ locale: "ko-KR" });
const kp = await ko.newPage();
await kp.goto(`http://localhost:${port}/`);
check("Korean UI for ko locale", (await kp.textContent(".open-btn span")) === "PDF 열기");
await ko.close();

await browser.close();
server.close();
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
