import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { checkSimultaneous } from "./online_simultaneous.mjs";
import { assertCompactTargetHud } from "./guidance_ui.mjs";

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
    Object.assign(app.cfg, { INITIAL_CASH: 100_000, PLAY_ORDER: "ROUND-ROBIN", PLAY_MODE: "SIMULTANEOUS", MAX_WIND: 0, FALLING_TANKS: "OFF", SOUND: "ON" });
    app._act("start_game");
  });
  await click(host, "Local");
  await click(host, "Continue");
  await host.waitForFunction(() => window.onlineApp.top.result !== undefined);
  await host.evaluate(() => {
    window.onlineApp._act("to_menu");
    window.onlineApp.cfg.PLAY_MODE = "SEQUENTIAL";
    window.onlineApp._act("start_game");
  });
  await host.getByRole("spinbutton", { name: "Rounds", exact: true }).fill("2");
  await click(host, "Online");
  await host.getByRole("textbox", { name: "Join link", exact: true }).waitFor();
  const shareUrl = await host.getByRole("textbox", { name: "Join link", exact: true }).inputValue();
  assert.ok(!shareUrl.includes("localhost") && !shareUrl.includes("127.0.0.1"));
  const joinUrl = `${base}/${new URL(shareUrl).search}`;
  assert.ok(await host.locator("canvas.lan-qr").evaluate((c) => c.width > 100 && c.height > 100));
  assert.equal(await enabled(host, "Start online game"), false);

  const contextA = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const contextB = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true });
  for (const context of [contextA, contextB]) {
    await context.addInitScript(() => {
      window.audioStarts = 0;
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        window.audioStarts++;
        return start.apply(this, args);
      };
    });
  }
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
  await host.waitForFunction(async () => (await import("/src/sound.ts")).sfx._ctx?.state === "running");
  await until(() => enabled(a, "Done"), "Alice shopping");
  assert.equal(await enabled(b, "Space / Fire"), false);
  assert.equal(await host.evaluate(() => window.onlineApp.cfg.PLAY_MODE), "SEQUENTIAL");
  assert.equal(await host.evaluate(() => window.onlineApp.gs.cfg.MAXROUNDS), 2);
  const cash = () => host.evaluate(() => window.onlineApp.gs.tanks[0].cash);
  const beforeCash = await cash();
  await a.locator(".lan-controls button:enabled").filter({ hasText: /\$/ }).first().click();
  await until(async () => await cash() < beforeCash, "purchase applies on host");
  const purchasedCash = await cash();
  await a.getByLabel("Category", { exact: true }).selectOption("1");
  for (const item of ["Battery", "Fuel Tank", "Heat Guidance", "Lazy Boy", "Shield", "Parachute"]) {
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
  await b.getByLabel("Category", { exact: true }).selectOption("1");
  await b.locator(".lan-controls button:enabled").filter({ hasText: /^(▶ )?Lazy Boy ·/ }).click();
  await until(async () => await host.evaluate(() => window.onlineApp.gs.tanks[1].inventory[37]) > 0, "Bob buys guidance");
  await click(b, "Done");
  await until(() => enabled(a, "Space / Fire"), "Alice aiming");
  // Observe real adjustment tone playback on the host, without replacing it.
  await host.evaluate(async () => {
    const { sfx } = await import("/src/sound.ts");
    window.adjustmentTicks = [];
    const beep = sfx.beep.bind(sfx);
    sfx.beep = (freq, ms, gate) => {
      if (ms === 20 && (freq === 600 || freq === 900)) window.adjustmentTicks.push(freq);
      return beep(freq, ms, gate);
    };
  });
  const ticks = () => host.evaluate(() => window.adjustmentTicks);
  const angle = () => host.evaluate(() => window.onlineApp.gs.tanks[0].angle);
  const initialAngle = await angle();
  await click(a, "← Angle");
  await until(async () => await angle() > initialAngle, "angle changes");
  assert.deepEqual(await ticks(), [600]);
  const afterTap = await angle();
  // Forged input from the inactive player is rejected by the relay and host.
  await b.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowLeft" })));
  await pause(300); assert.equal(await angle(), afterTap);
  assert.deepEqual(await ticks(), [600]);
  // Holding, losing focus, and release must not leave aim stuck.
  const arrow = a.getByRole("button", { name: "← Angle", exact: true });
  const box = await arrow.boundingBox();
  await a.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await a.mouse.down(); await pause(500); await a.mouse.up();
  await pause(200); const afterHold = await angle();
  assert.ok(afterHold > afterTap);
  const afterHoldTicks = await ticks();
  assert.ok(afterHoldTicks.length > 2 && afterHoldTicks.every((freq) => freq === 600));
  await pause(650); assert.equal(await angle(), afterHold);
  assert.deepEqual(await ticks(), afterHoldTicks);
  await click(a, "↑ Power");
  await until(async () => (await ticks()).at(-1) === 900, "power tick on host");
  const beforeMuteTicks = await ticks();
  await host.evaluate(() => { window.onlineApp.cfg.SOUND = "OFF"; });
  await click(a, "↓ Power");
  await pause(150);
  assert.deepEqual(await ticks(), beforeMuteTicks);
  await host.evaluate(() => {
    window.onlineApp.cfg.SOUND = "ON";
    window.onlineApp.gs.tanks[0].angle = 180;
  });
  await click(a, "← Angle");
  await pause(150);
  assert.deepEqual(await ticks(), beforeMuteTicks);
  await click(a, "Tank controls");
  await a.getByRole("heading", { name: /Tank controls/ }).waitFor();
  const beforePanelTicks = (await ticks()).length;
  await a.getByLabel("Remaining Power:").fill("300");
  await a.getByLabel("Remaining Power:").press("Tab");
  await until(async () => await host.evaluate(() => window.onlineApp.gs.tanks[0].power) === 300, "tank panel power");
  assert.equal((await ticks()).length, beforePanelTicks + 1);
  assert.equal((await ticks()).at(-1), 900);
  assert.equal(await a.evaluate(() => window.audioStarts), 0);
  assert.equal(await b.evaluate(() => window.audioStarts), 0);
  // Exercise the nested equipment dialog using purchased batteries.
  await host.evaluate(() => { window.onlineApp.gs.tanks[0].health = 80; });
  await a.getByRole("button", { name: /^Batteries:/ }).click();
  await a.getByLabel("Batteries to discharge:").fill("2");
  await a.getByLabel("Batteries to discharge:").press("Tab");
  await click(a, "Ok");
  await until(async () => await host.evaluate(() => window.onlineApp.gs.tanks[0].health) === 100, "battery discharge");
  assert.equal(await host.evaluate(() => window.onlineApp.gs.tanks[0].inventory[39]), 8);
  await a.getByLabel(/^Parachutes/).check();
  await a.getByLabel("Guidance", { exact: true }).selectOption({ label: "Lazy Boy" });
  await until(async () => await host.evaluate(() => window.onlineApp.gs.tanks[0].selected_guidance) === 37, "guidance equipped");
  await click(a, "Engage");
  await until(() => enabled(a, "Space / Fire"), "back to battle");
  assert.equal(await a.getByLabel("Target X", { exact: true }).count(), 0);
  // Equipping guidance permits inventory, retreat and aiming before Fire.
  await click(a, "Inventory");
  await a.getByLabel("Guidance", { exact: true }).selectOption("2");
  await click(a, "Done");
  await until(() => enabled(a, "Space / Fire"), "inventory closes");
  await click(a, "Retreat");
  await a.getByRole("button", { name: "Yes", exact: true }).waitFor();
  await click(a, "Back / Esc");
  await a.getByRole("heading", { name: /Alice · Battle/ }).waitFor();
  await until(() => enabled(a, "Space / Fire"), "retreat canceled");
  assert.equal(await host.evaluate(() => window.onlineApp.gs.tanks[0].selected_guidance), 37);
  const guidanceStock = await host.evaluate(() => window.onlineApp.gs.tanks[0].inventory[37]);
  await click(a, "Space / Fire");
  await a.getByLabel("Target X", { exact: true }).waitFor();
  assert.equal(await enabled(a, "Fire at target"), false);
  assert.equal(await enabled(a, "← Angle"), false);
  assert.equal(await enabled(b, "Fire at target"), false);
  await host.locator("[data-targeting]").waitFor({ state: "visible" });
  await assertCompactTargetHud(host, false);
  await a.getByRole("button", { name: /^\d+: Bob$/ }).click();
  await until(async () => await host.evaluate(() => window.onlineApp.gs.pendingTarget?.target?.name) === "Bob", "target draft");
  const xField = a.getByLabel("Target X", { exact: true });
  for (const value of ["", "-1", "99999", "1.5"]) {
    await xField.fill(value);
    assert.equal(await enabled(a, "Fire at target"), false);
  }
  await xField.fill("200"); await xField.press("Tab");
  await a.getByLabel("Target Y", { exact: true }).fill("100");
  await a.getByLabel("Target Y", { exact: true }).press("Tab");
  await until(async () => await host.evaluate(() => JSON.stringify(window.onlineApp.gs.pendingTarget?.point)) === "[200,100]", "coordinate draft");
  await a.screenshot({ path: `${root}/test-browser/out/online-guidance.png`, fullPage: true });
  await host.screenshot({ path: `${root}/test-browser/out/online-guidance-host.png` });
  // Lost network on the active player's turn leaves the game waiting.
  await contextA.setOffline(true);
  await pause(800);
  assert.equal(await host.evaluate(() => window.onlineApp.gs.current_shooter.name), "Alice");
  await contextA.setOffline(false);
  await a.reload();
  await until(() => enabled(a, "Fire at target"), "rejoin target selection");
  assert.equal(await a.getByLabel("Target X", { exact: true }).inputValue(), "200");
  assert.equal(await a.getByLabel("Target Y", { exact: true }).inputValue(), "100");
  const replacement = await contextA.newPage(); wireErrors(replacement);
  await replacement.goto(joinUrl);
  await until(() => enabled(replacement, "Fire at target"), "replacement controller");
  await until(async () => (await a.locator(".lan-status").textContent()).includes("another tab"), "old controller replaced");
  await a.close(); a = replacement;
  assert.equal(await host.evaluate(() => window.onlineApp.gs.tanks.length), 3);
  await click(a, "Cancel targeting");
  await until(() => enabled(a, "Space / Fire"), "targeting canceled");
  assert.equal(await host.evaluate(() => window.onlineApp.gs.tanks[0].inventory[37]), guidanceStock);
  assert.equal(await host.locator("[data-targeting]").isVisible(), false);
  assert.equal(await host.evaluate(() => window.onlineApp.renderer.targetHud), null);
  // Plasma's charge is host state; cancellation and reconnect preserve ammo.
  await host.evaluate(() => {
    const t = window.onlineApp.gs.tanks[0];
    t.inventory[31] = 2; t.selected_weapon = 31;
  });
  await click(a, "Space / Fire");
  await a.getByLabel("Batteries for Plasma", { exact: true }).waitFor();
  assert.equal(await b.getByLabel("Batteries for Plasma", { exact: true }).count(), 0);
  await a.getByLabel("Batteries for Plasma", { exact: true }).fill("5");
  await a.getByLabel("Batteries for Plasma", { exact: true }).press("Tab");
  await until(async () => await host.evaluate(() => window.onlineApp.gs.plasma_charge?.value) === 5, "charge reaches host");
  await a.reload();
  await a.getByLabel("Batteries for Plasma", { exact: true }).waitFor();
  assert.equal(await a.getByLabel("Batteries for Plasma", { exact: true }).inputValue(), "5");
  await click(a, "Cancel");
  await until(async () => await host.evaluate(() => window.onlineApp.gs.plasma_charge) === null, "charge canceled");
  assert.deepEqual(await host.evaluate(() => {
    const t = window.onlineApp.gs.tanks[0]; return [t.inventory[31], t.inventory[39]];
  }), [2, 8]);
  await click(a, "Space / Fire");
  await a.getByLabel("Batteries for Plasma", { exact: true }).waitFor();
  await a.getByLabel("Batteries for Plasma", { exact: true }).fill("5");
  await a.getByLabel("Batteries for Plasma", { exact: true }).press("Tab");
  await a.screenshot({ path: `${root}/test-browser/out/online-controller.png`, fullPage: true });
  // Observe fire synchronously through a real game method, without changing it.
  await host.evaluate(() => {
    const gs = window.onlineApp.gs;
    const fire = gs.fire.bind(gs); window.shotCount = 0;
    gs.fire = (...args) => { window.shotCount++; return fire(...args); };
  });
  await click(a, "Fire Plasma");
  await until(async () => await host.evaluate(() => window.shotCount) > 0, "firing");
  assert.deepEqual(await host.evaluate(() => {
    const t = window.onlineApp.gs.tanks[0]; return [t.inventory[31], t.inventory[39]];
  }), [1, 3]);
  await until(async () => !await enabled(a, "Space / Fire"), "controller locked after firing");
  // End rounds deterministically through the real engine rather than waiting for random AI hits.
  await host.evaluate(() => { window.onlineApp.gs.mass_kill(); });
  await host.waitForFunction(() => window.onlineApp.onlineScreen === "rankings");
  await click(host, "Continue to purchasing");
  await until(() => enabled(a, "Done"), "between-round purchasing");
  await a.reload(); await until(() => enabled(a, "Done"), "rejoin purchasing");
  await click(a, "Done"); await until(() => enabled(b, "Done"), "next shopper"); await click(b, "Done");
  await host.waitForFunction(() => window.onlineApp.onlineScreen === "battle");
  await host.waitForFunction(() => window.onlineApp.gs.phase === "aim");
  assert.equal(await host.evaluate(() => window.onlineApp.gs.current_shooter.name), "Bob");
  await host.evaluate(() => { window.onlineApp.gs.current_shooter.selected_guidance = 37; });
  const bobStock = await host.evaluate(() => window.onlineApp.gs.tanks[1].inventory[37]);
  await until(() => enabled(b, "Space / Fire"), "second-round aiming");
  await click(b, "Space / Fire");
  await b.getByLabel("Target X", { exact: true }).waitFor();
  await b.getByRole("button", { name: /^\d+: Alice$/ }).click();
  await until(() => enabled(b, "Fire at target"), "target ready");
  const count = await host.evaluate(() => window.shotCount);
  await click(b, "Fire at target");
  await until(async () => await host.evaluate(() => window.onlineApp.gs.tanks[1].inventory[37]) === bobStock - 1, "guided shot spends one accessory");
  assert.equal(await host.evaluate(() => window.shotCount), count + 1);
  assert.equal(await host.evaluate(() => window.onlineApp.gs.pendingTarget), null);
  await host.evaluate(() => { window.onlineApp.gs.mass_kill(); });
  await host.waitForFunction(() => window.onlineApp.onlineScreen === "rankings");
  await click(host, "Continue to purchasing");
  await host.waitForFunction(() => window.onlineApp.onlineScreen === "finished");
  await until(async () => (await a.locator(".lan-status").textContent()).includes("Match complete"), "final results");
  await host.screenshot({ path: `${root}/test-browser/out/online-host.png` });
  await click(host, "Return to menu");
  await until(async () => (await a.locator(".lan-status").textContent()).includes("ended"), "room closed");
  assert.equal(await host.evaluate(() => window.onlineApp.cfg.PLAY_MODE), "SEQUENTIAL");
  await checkSimultaneous({ host, a, b, base, root, click, enabled, until, pause });
  assert.deepEqual(errors, []);
  console.log("PASS: local choice, lobby, AI, mobile controls, ownership, holds, inventory, purchases, reconnects, replacement, round progression, match completion");
} catch (error) {
  console.error(error);
  for (const context of browser?.contexts() ?? []) {
    for (const page of context.pages()) {
      if (page.url().includes("online_host.html")) console.error("Host state:", JSON.stringify(await page.evaluate(() => {
        const gs = window.onlineApp.gs, t = gs.current_shooter;
        return { phase: gs.phase, mode: gs.cfg.play_mode, pending: !!gs.pendingTarget, selected: t?.selected_guidance, stock: t?.inventory.slice(33, 38) };
      }).catch(() => null)));
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
