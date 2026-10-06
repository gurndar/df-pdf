// Shared Playwright setup for tests, benchmarks and icon rendering.
// Uses the project's playwright devDependency, falling back to a global install,
// and a preinstalled Chromium when CHROMIUM_PATH (or /opt/pw-browsers) provides one.
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    const root = execSync("npm root -g").toString().trim();
    return await import(path.join(root, "playwright", "index.mjs"));
  }
}

export const { chromium } = await loadPlaywright();

const preinstalled = "/opt/pw-browsers/chromium";
export const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync(preinstalled) ? preinstalled : undefined);
