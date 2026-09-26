import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const base = process.env.ONLINE_TEST_URL || "http://127.0.0.1:4317";
let server;
let serverLog = "";
let browser;
const errors = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, label, timeout = 20_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return;
    await pause(80);
  }
  throw new Error(`Timed out: ${label}`);
}
const wireErrors = (page) => {
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("response", (r) => { if (r.status() >= 400 && /\/(src|assets)\//.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
};
const click = (page, name) => page.getByRole("button", { name, exact: true }).click();
const enabled = async (page, name) => {
  const b = page.getByRole("button", { name, exact: true });
  return await b.count() > 0 && await b.isEnabled();
};

try {
  if (!process.env.ONLINE_TEST_URL) {
    server = spawn(process.execPath, ["--import", "tsx", "server/index.ts", "--dev"], {
      cwd: root, env: { ...process.env, PORT: "4317" }, stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout.on("data", (b) => { serverLog += b; });
    server.stderr.on("data", (b) => { serverLog += b; });
  }
  await until(async () => { try { return (await fetch(`${base}/api/lan`)).ok; } catch { return false; } }, "LAN server");
  const executablePath = process.env.CHROMIUM_PATH || ["/usr/bin/chromium", "/usr/bin/google-chrome"].find(existsSync);
  browser = await chromium.launch({ executablePath, args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
  const hostContext = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const host = await hostContext.newPage(); wireErrors(host);
  await host.goto(`${base}/test-browser/online_host.html`);
  await host.waitForFunction(() => !!window.onlineApp);
  await host.evaluate(() => {
    const app = window.onlineApp;
    Object.assign(app.cfg, { INITIAL_CASH: 100_000, MAXROUNDS: 2, PLAY_ORDER: "ROUND-ROBIN", PLAY_MODE: "SIMULTANEOUS", MAX_WIND: 0, FALLING_TANKS: "OFF", SOUND: "OFF" });
    app._act("start_game");
  });
  await click(host, "Local");
  await host.waitForFunction(() => window.onlineApp.top.result !== undefined);
  await host.evaluate(() => { window.onlineApp._act("to_menu"); window.onlineApp._act("start_game"); });
  await click(host, "Online");
  await host.getByRole("textbox", { name: "Join link", exact: true }).waitFor();
  const shareUrl = await host.getByRole("textbox", { name: "Join link", exact: true }).inputValue();
  assert.ok(!shareUrl.includes("localhost") && !shareUrl.includes("127.0.0.1"));
  const joinUrl = `${base}/${new URL(shareUrl).search}`;
  assert.ok(await host.locator("canvas.lan-qr").evaluate((c) => c.width > 100 && c.height > 100));
  assert.equal(await enabled(host, "Start online game"), false);

  const contextA = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const contextB = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true });
  let a = await contextA.newPage(); wireErrors(a);
  const b = await contextB.newPage(); wireErrors(b);
  await a.goto(joinUrl); await b.goto(joinUrl);
  await a.getByPlaceholder("Your name").fill("Alice");
  await click(a, "Choose tank 2"); await click(a, "Ready");
  await b.getByPlaceholder("Your name").fill("Bob"); await click(b, "Ready");
  await host.getByLabel("Computer difficulty").selectOption("1");
  await click(host, "Add computer");
  await until(() => enabled(host, "Start online game"), "ready lobby");
  await click(host, "Start online game");
  await until(() => enabled(a, "Done"), "Alice shopping");
  assert.equal(await enabled(b, "Space / Fire"), false);
  assert.equal(await host.evaluate(() => window.onlineApp.cfg.PLAY_MODE), "SEQUENTIAL");
  const cash = () => host.evaluate(() => window.onlineApp.gs.tanks[0].cash);
  const beforeCash = await cash();
  await a.locator(".lan-controls button:enabled").filter({ hasText: /\$/ }).first().click();
  await until(async () => await cash() < beforeCash, "purchase applies on host");
  const purchasedCash = await cash();
  await a.getByLabel("Category", { exact: true }).selectOption("1");
  for (const item of ["Battery", "Fuel Tank", "Heat Guidance", "Shield", "Parachute"]) {
    const previousCash = await cash();
    await a.locator(".lan-controls button:enabled").filter({ hasText: new RegExp(`^(▶ )?${item} ·`) }).click();
    await until(async () => await cash() < previousCash, `${item} purchased`);
  }
  const equippedCash = await cash();
  assert.ok(equippedCash < purchasedCash);
  await click(a, "Inventory");
  await a.getByRole("heading", { name: /Inventory/ }).waitFor();
  await a.reload();
  await a.getByRole("heading", { name: /Inventory/ }).waitFor();
  assert.equal(await cash(), equippedCash);
  await click(a, "Done");
  await a.getByRole("heading", { name: /Purchasing/ }).waitFor();
  mkdirSync(`${root}/test-browser/out`, { recursive: true });
  await a.screenshot({ path: `${root}/test-browser/out/online-shopping.png`, fullPage: true });
  await click(a, "Done");
  await until(() => enabled(b, "Done"), "Bob shopping");
  await click(b, "Done");
  await until(() => enabled(a, "Space / Fire"), "Alice aiming");
  const angle = () => host.evaluate(() => window.onlineApp.gs.tanks[0].angle);
  const initialAngle = await angle();
  await click(a, "← Angle");
  await until(async () => await angle() > initialAngle, "angle changes");
  const afterTap = await angle();
  // Forged input from the inactive player is rejected by the relay and host.
  await b.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowLeft" })));
  await pause(300); assert.equal(await angle(), afterTap);
  // Holding, losing focus, and release must not leave aim stuck.
  const arrow = a.getByRole("button", { name: "← Angle", exact: true });
  const box = await arrow.boundingBox();
  await a.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await a.mouse.down(); await pause(500); await a.mouse.up();
  await pause(200); const afterHold = await angle();
  assert.ok(afterHold > afterTap);
  await pause(650); assert.equal(await angle(), afterHold);
  await click(a, "Tank controls");
  await a.getByRole("heading", { name: /Tank controls/ }).waitFor();
  await a.getByLabel("Remaining Power:").fill("300");
  await a.getByLabel("Remaining Power:").press("Tab");
  await until(async () => await host.evaluate(() => window.onlineApp.gs.tanks[0].power) === 300, "tank panel power");
  // Exercise the nested equipment dialog using purchased batteries.
  await host.evaluate(() => { window.onlineApp.gs.tanks[0].health = 80; });
  await a.getByRole("button", { name: /^Batteries:/ }).click();
  await a.getByLabel("Batteries to discharge:").fill("2");
  await a.getByLabel("Batteries to discharge:").press("Tab");
  await click(a, "Ok");
  await until(async () => await host.evaluate(() => window.onlineApp.gs.tanks[0].health) === 100, "battery discharge");
  assert.equal(await host.evaluate(() => window.onlineApp.gs.tanks[0].inventory[39]), 8);
  await a.getByLabel(/^Parachutes/).check();
  await a.getByLabel("Guidance", { exact: true }).selectOption({ label: "Heat Guidance" });
  await until(async () => await host.evaluate(() => window.onlineApp.gs.tanks[0].selected_guidance) === 33, "guidance equipped");
  await click(a, "Engage");
  await until(() => enabled(a, "Space / Fire"), "back to battle");
  await a.getByLabel("Choose target", { exact: true }).selectOption("1");
  await until(async () => await host.evaluate(() => window.onlineApp.gs.tanks[0].guidance_target?.name) === "Bob", "target selection");
  // Inventory selection and canceled retreat must preserve the chosen target.
  await click(a, "Inventory");
  await a.getByLabel("Guidance", { exact: true }).selectOption("1");
  await click(a, "Done");
  await until(() => enabled(a, "Space / Fire"), "inventory closes");
  await click(a, "Retreat");
  await a.getByRole("button", { name: "Yes", exact: true }).waitFor();
  await click(a, "Back / Esc");
  await until(() => enabled(a, "Space / Fire"), "retreat canceled");
  // Lost network on the active player's turn leaves the game waiting.
  await contextA.setOffline(true);
  await pause(800);
  assert.equal(await host.evaluate(() => window.onlineApp.gs.current_shooter.name), "Alice");
  await contextA.setOffline(false);
  await a.reload();
  await until(() => enabled(a, "Space / Fire"), "rejoin active turn");
  const replacement = await contextA.newPage(); wireErrors(replacement);
  await replacement.goto(joinUrl);
  await until(() => enabled(replacement, "Space / Fire"), "replacement controller");
  await until(async () => (await a.locator(".lan-status").textContent()).includes("another tab"), "old controller replaced");
  await a.close(); a = replacement;
  assert.equal(await host.evaluate(() => window.onlineApp.gs.tanks.length), 3);
  await a.screenshot({ path: `${root}/test-browser/out/online-controller.png`, fullPage: true });
  // Observe fire synchronously through a real game method, without changing it.
  await host.evaluate(() => {
    const gs = window.onlineApp.gs;
    const fire = gs.fire.bind(gs); window.shotCount = 0;
    gs.fire = (...args) => { window.shotCount++; return fire(...args); };
  });
  await click(a, "Space / Fire");
  await until(async () => await host.evaluate(() => window.shotCount) > 0, "firing");
  await until(async () => !await enabled(a, "Space / Fire"), "controller locked after firing");
  // End rounds deterministically through the real engine rather than waiting for random AI hits.
  await host.evaluate(() => { window.onlineApp.gs.mass_kill(); });
  await host.waitForFunction(() => window.onlineApp.onlineScreen === "rankings");
  await click(host, "Continue to purchasing");
  await until(() => enabled(a, "Done"), "between-round purchasing");
  await a.reload(); await until(() => enabled(a, "Done"), "rejoin purchasing");
  await click(a, "Done"); await until(() => enabled(b, "Done"), "next shopper"); await click(b, "Done");
  await host.waitForFunction(() => window.onlineApp.onlineScreen === "battle");
  await host.evaluate(() => { window.onlineApp.gs.mass_kill(); });
  await host.waitForFunction(() => window.onlineApp.onlineScreen === "rankings");
  await click(host, "Continue to purchasing");
  await host.waitForFunction(() => window.onlineApp.onlineScreen === "finished");
  await until(async () => (await a.locator(".lan-status").textContent()).includes("Match complete"), "final results");
  await host.screenshot({ path: `${root}/test-browser/out/online-host.png` });
  await click(host, "Return to menu");
  await until(async () => (await a.locator(".lan-status").textContent()).includes("ended"), "room closed");
  assert.equal(await host.evaluate(() => window.onlineApp.cfg.PLAY_MODE), "SIMULTANEOUS");
  assert.deepEqual(errors, []);
  console.log("PASS: local choice, lobby, AI, mobile controls, ownership, holds, inventory, purchases, reconnects, replacement, round progression, match completion");
} catch (error) {
  console.error(error);
  for (const context of browser?.contexts() ?? []) {
    for (const page of context.pages()) {
      console.error("Page:", page.url(), (await page.locator("body").innerText().catch(() => "")).slice(0, 2500));
    }
  }
  console.error("Browser errors:", errors);
  console.error("Server log:", serverLog);
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server) {
    server.kill("SIGTERM");
    await new Promise((resolve) => {
      if (server.exitCode !== null) return resolve();
      server.once("exit", resolve);
      setTimeout(() => { server.kill("SIGKILL"); resolve(); }, 3000).unref();
    });
  }
}
