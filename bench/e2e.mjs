// End-to-end checks in real Chromium.
//   node bench/e2e.mjs path/to/with-outline.pdf [screenshot.png]
// The PDF should come from: python3 experiments/01-load-memory/gen.py 1081 full.pdf --outline --links
import fs from "fs";
import os from "os";
import path from "path";
import { serve } from "../scripts/serve.mjs";
import { chromium, executablePath } from "../scripts/browser.mjs";

const file = path.resolve(process.argv[2] || "full.pdf");
const shot = process.argv[3];
const port = 8097;
const server = await serve(port);
const browser = await chromium.launch({ executablePath });

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
}

const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: "en-US" });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const logs = [];
page.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
// On timeout, print the viewer's state so a hang can be diagnosed.
const rendered = (n) =>
  page.waitForFunction((n) => window.__reader.viewer?.slots.get(n)?.rendered, n, { timeout: 30000 }).catch(async (e) => {
    const state = await page.evaluate(() => {
      const v = window.__reader.viewer;
      return {
        name: document.getElementById("name").textContent,
        viewer: !!v,
        slots: v && [...v.slots.entries()].map(([k, s]) => `${k}:${s.rendered ? "r" : "-"}`),
        queue: v?.queue,
        rendering: !!v?.rendering,
        read: window.__reader.transport()?.bytesRead,
        swControlled: !!navigator.serviceWorker.controller,
      };
    }).catch((err) => `state unavailable: ${err.message}`);
    console.log(`waiting for page ${n} to render timed out`, JSON.stringify(state), logs.slice(-10));
    throw e;
  });
const current = () => page.evaluate(() => window.__reader.viewer.currentPage);

await page.goto(`http://localhost:${port}/?sw`);
check("English UI", (await page.textContent(".open-btn span")) === "Open PDF");

// Manifest & installability (Chromium's own checks). Needs a non-incognito profile.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "df-profile-"));
  const persistent = await chromium.launchPersistentContext(dir, {
    executablePath,
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
  const version = await p.textContent("#version");
  check("shows app version", /^dF v\d+\.\d+\.\d+$/.test(version), version);
  await persistent.setOffline(true);
  await p.reload();
  check("works offline from the cache", (await p.textContent("#version")) === version);
  await persistent.setOffline(false);
  await persistent.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

// Open, then text selection and links on page 1.
await page.setInputFiles("#file", file);
await rendered(1);
const layersReady = (n) => page.waitForFunction((n) => window.__reader.viewer?.slots.get(n)?.layersReady, n, { timeout: 30000 });
await layersReady(1);
const p1 = '.page[data-page="1"]';
const spans = await page.$$eval(`${p1} .textLayer span`, (els) => els.map((e) => e.textContent));
check("text layer has the page text", spans.includes("Page 1") && spans.includes("See page 101"), JSON.stringify(spans));

const box = await page.locator(`${p1} .textLayer span`, { hasText: /^Page 1$/ }).boundingBox();
await page.mouse.move(box.x + 1, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 5 });
await page.mouse.up();
const selected = await page.evaluate(() => window.getSelection().toString());
check("dragging selects text", selected.includes("Page"), JSON.stringify(selected));

const external = await page.$eval(`${p1} .linkLayer a[target="_blank"]`, (a) => [a.href, a.rel]);
check("web link opens safely in a new tab", external[0] === "https://example.com/" && external[1].includes("noopener"), external.join(" "));
await page.click(`${p1} .linkLayer a[href="#"]`);
await rendered(101);
check("internal link jumps to its page", (await current()) === 101, `page ${await current()}`);
await layersReady(101);
const layerPages = await page.$$eval(".textLayer", (els) => els.map((e) => e.closest(".page").dataset.page));
check("layers only for on-screen pages", !layerPages.includes("1") && layerPages.length <= 3, layerPages.join(","));

// Table of contents.
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

// A file that can no longer be read (moved, drive removed) shows an error instead of hanging.
await page.evaluate(() => {
  Blob.prototype.arrayBuffer = () => Promise.reject(new DOMException("gone", "NotReadableError"));
});
await page.evaluate(() => window.__reader.viewer.goto(900));
await page.waitForFunction(() => document.getElementById("toast").textContent.includes("can't be read"), null, { timeout: 15000 })
  .then(() => check("unreadable file shows an error", true))
  .catch(async () => check("unreadable file shows an error", false, await page.textContent("#toast")));
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
