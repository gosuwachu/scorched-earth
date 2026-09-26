// Smoke-test the shipped entrypoint and built server, with no game-state harness.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const server = spawn(process.execPath, ["dist-server/server/index.js"], {
  cwd: root, env: { ...process.env, PORT: "4318" }, stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
server.stdout.on("data", (b) => { log += b; });
server.stderr.on("data", (b) => { log += b; });
let browser;
try {
  const base = "http://127.0.0.1:4318";
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { up = (await fetch(`${base}/api/lan`)).ok; } catch { /* starting */ }
    if (!up) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(up, `Production server did not start: ${log}`);
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || ["/usr/bin/chromium", "/usr/bin/google-chrome"].find(existsSync),
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  const errors = [];
  const hostContext = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await hostContext.addInitScript(() => localStorage.setItem("scorch.cfg", "INITIAL_CASH=100000\nPLAY_ORDER=ROUND-ROBIN\nHOSTILE_ENVIRONMENT=OFF\nSOUND=OFF\n"));
  const host = await hostContext.newPage();
  host.on("pageerror", (e) => errors.push(String(e)));
  await host.goto(base);
  await host.locator("#loading.done").waitFor({ state: "attached" });
  await host.keyboard.press("Enter");
  await host.getByRole("button", { name: "Online", exact: true }).click();
  const link = host.getByRole("textbox", { name: "Join link", exact: true });
  await link.waitFor();
  const join = await link.inputValue();
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const phone = await phoneContext.newPage();
  phone.on("pageerror", (e) => errors.push(String(e)));
  // Use the actual generated LAN address, not a rewritten localhost URL.
  await phone.goto(join);
  await phone.getByPlaceholder("Your name").fill("Player1");
  await phone.getByRole("button", { name: "Ready", exact: true }).click();
  await host.getByRole("button", { name: "Add computer", exact: true }).click();
  mkdirSync(`${root}/test-browser/out`, { recursive: true });
  await host.screenshot({ path: `${root}/test-browser/out/online-lobby.png` });
  await host.getByRole("button", { name: "Start online game", exact: true }).click();
  await phone.getByRole("button", { name: "Done", exact: true }).click();
  await phone.getByRole("button", { name: "Tank controls", exact: true }).waitFor();
  const before = await phone.locator(".lan-stats").textContent();
  await phone.getByRole("button", { name: "← Angle", exact: true }).tap();
  await phone.waitForFunction((before) => document.querySelector(".lan-stats").textContent !== before, before);
  await phone.reload();
  await phone.getByRole("button", { name: "Tank controls", exact: true }).waitFor();
  await host.screenshot({ path: `${root}/test-browser/out/online-production-host.png` });
  const canvas = await host.locator("#game").boundingBox();
  const bar = await host.locator(".lan-bar").boundingBox();
  assert.ok(canvas.y + canvas.height <= bar.y + 1, "The host toolbar must not cover the battlefield");
  assert.deepEqual(errors, []);
  console.log("PASS: production server, shipping entrypoint, real LAN join URL, touch control, refresh recovery, host layout");
} catch (error) {
  console.error(error, log);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await new Promise((resolve) => {
    if (server.exitCode !== null) return resolve();
    server.once("exit", resolve);
    setTimeout(() => { server.kill("SIGKILL"); resolve(); }, 3000).unref();
  });
}
