// Opens a PDF in the reader inside real Chromium and records peak memory
// (PSS summed over every Chromium process spawned by this script) for "range" vs "whole" loading.
//
//   node bench/browser-bench.mjs path/to/big.pdf [range|range-nobudget|range:<MB>|whole ...]
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { serve } from "../scripts/serve.mjs";

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    const root = execSync("npm root -g").toString().trim();
    return await import(path.join(root, "playwright", "index.mjs"));
  }
}

function descendants(pid) {
  const children = new Map();
  for (const p of fs.readdirSync("/proc").filter((d) => /^\d+$/.test(d))) {
    try {
      const ppid = Number(fs.readFileSync(`/proc/${p}/stat`, "utf8").split(") ")[1].split(" ")[1]);
      if (!children.has(ppid)) children.set(ppid, []);
      children.get(ppid).push(Number(p));
    } catch {}
  }
  const out = [pid];
  for (let i = 0; i < out.length; i++) out.push(...(children.get(out[i]) || []));
  return out.slice(1);
}

function pssMB(rootPid) {
  let kb = 0;
  for (const p of descendants(rootPid)) {
    try {
      kb += Number(fs.readFileSync(`/proc/${p}/smaps_rollup`, "utf8").match(/^Pss:\s+(\d+)/m)[1]);
    } catch {}
  }
  return kb / 1024;
}

async function run(chromium, file, mode, port) {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  // Chromium runs as children of this node process.
  const pid = process.pid;
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("crash", () => errors.push("RENDERER CRASHED"));
  const query = { range: "", "range-nobudget": "budget=0", whole: "mode=whole" }[mode]
    ?? mode.replace(/^range:(\d+)$/, "budget=$1"); // e.g. range:96
  await page.goto(`http://localhost:${port}/?${query}`);
  const idle = pssMB(pid);

  let peak = 0;
  const sampler = setInterval(() => (peak = Math.max(peak, pssMB(pid))), 100);
  const rendered = (n) =>
    page.waitForFunction((n) => window.__reader.viewer?.slots.get(n)?.rendered, n, { timeout: 120000 });
  const settle = () =>
    page.waitForFunction(() => {
      const v = window.__reader.viewer;
      return v && !v.rendering && v.queue.length === 0;
    }, null, { timeout: 120000, polling: 200 });

  const steps = [];
  const step = async (name, fn) => {
    const t = Date.now();
    peak = 0;
    await fn();
    peak = Math.max(peak, pssMB(pid));
    steps.push({ name, ms: Date.now() - t, peakMB: Math.round(peak), nowMB: Math.round(pssMB(pid)) });
  };

  try {
    await step("open + page 1", async () => {
      await page.setInputFiles("#file", file);
      await rendered(1);
    });
    await step("jump to 540", async () => {
      await page.evaluate(() => window.__reader.viewer.goto(540));
      await rendered(540);
    });
    await step("jump to 1081", async () => {
      await page.evaluate(() => window.__reader.viewer.goto(1081));
      await rendered(1081);
    });
    await step("fast scroll 4s", async () => {
      await page.evaluate(() => window.__reader.viewer.goto(100));
      await page.evaluate(() => new Promise((done) => {
        const el = document.getElementById("viewer");
        const end = performance.now() + 4000;
        (function tick() {
          el.scrollTop += 400;
          if (performance.now() < end) requestAnimationFrame(tick); else done();
        })();
      }));
      await settle();
    });
    await step("slow scroll 40 pages", async () => {
      for (let i = 0; i < 40; i++) {
        await page.evaluate(() => (document.getElementById("viewer").scrollTop += 600));
        await page.waitForTimeout(150);
      }
      await settle();
    });
    await step("read 500 pages", async () => {
      for (let n = 200; n < 700; n++) {
        await page.evaluate((n) => window.__reader.viewer.goto(n), n);
        await rendered(n);
      }
      await settle();
    });
  } catch (e) {
    errors.push(e.message.split("\n")[0]);
  }
  clearInterval(sampler);
  const read = await page.evaluate(() => window.__reader.transport()?.bytesRead ?? null).catch(() => null);
  const recycles = await page.evaluate(() => window.__reader.recycles()).catch(() => null);
  await browser.close();
  return { mode, idleMB: Math.round(idle), steps, readMB: read && Math.round(read / 1048576), recycles, errors };
}

const file = path.resolve(process.argv[2] || "big.pdf");
const modes = process.argv.slice(3).length ? process.argv.slice(3) : ["range", "range-nobudget", "whole"];
const { chromium } = await loadPlaywright();
const port = 8099;
const server = await serve(port);
console.log(`file: ${file} (${Math.round(fs.statSync(file).size / 1e6)}MB)`);
for (const mode of modes) {
  const r = await run(chromium, file, mode, port);
  console.log(`\n== ${r.mode} (browser idle ${r.idleMB}MB${r.readMB != null ? `, read since last open ${r.readMB}MB, reopened ${r.recycles}x` : ""})`);
  for (const s of r.steps) console.log(`  ${s.name.padEnd(22)} ${String(s.ms).padStart(6)}ms  peak ${s.peakMB}MB  after ${s.nowMB}MB`);
  if (r.errors.length) console.log("  errors:", r.errors.join(" | "));
}
server.close();
