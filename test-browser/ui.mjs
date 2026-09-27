// Real DOM interaction checks for the local UI and its shared component library.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkOptionHelp } from "./option_help.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const base = process.env.UI_TEST_URL || "http://127.0.0.1:4320";
let server, browser;
let log = "";
const errors = [];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  if (!process.env.UI_TEST_URL) {
    server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "4320", "--strictPort"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    server.stdout.on("data", (b) => { log += b; }); server.stderr.on("data", (b) => { log += b; });
  }
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) { try { ready = (await fetch(base)).ok; } catch {} if (!ready) await pause(100); }
  assert.ok(ready, log);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || ["/usr/bin/chromium", "/usr/bin/google-chrome"].find(existsSync), args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/test-browser/online_host.html`);
  await page.waitForFunction(() => !!window.onlineApp);
  await page.evaluate(async () => {
    const { Panel } = await import("/src/widgets.ts");
    Panel.prototype.draw = () => { throw new Error("Production UI must not paint canvas panels"); };
  });
  const settled = () => page.waitForFunction(() => !window.onlineApp.transitioning);
  const click = async (name) => { await settled(); await page.getByRole("button", { name, exact: true }).click(); await settled(); };
  const shot = async (name) => page.screenshot({ path: `${root}/test-browser/out/ui-${name}.png` });
  mkdirSync(`${root}/test-browser/out`, { recursive: true });
  await shot("menu");
  await page.keyboard.press("F11");
  await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
  assert.ok(await page.getByRole("button", { name: "Start", exact: true }).isVisible());
  await page.keyboard.press("F11"); await page.waitForFunction(() => !document.fullscreenElement);
  // Every option screen uses native controls and returns focus to its opener.
  for (const name of ["Sound...", "Hardware...", "Economics...", "Landscape...", "Physics...", "Play Options...", "Weapons..."]) {
    await click(name);
    assert.equal(await page.locator("dialog[open]").count(), 1);
    await shot(name.toLowerCase().replace(/[^a-z]/g, ""));
    await page.keyboard.press("Escape"); await settled();
    assert.equal(await page.locator("dialog[open]").count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement.textContent), name);
  }
  await checkOptionHelp(page, { click, settled, shot });
  await click("About"); assert.ok(await page.getByText("Register Scorched Earth", { exact: true }).isVisible()); await click("OK");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await click("Sound..."); assert.equal(await page.evaluate(() => window.onlineApp.transitioning), false);
  await page.keyboard.press("Tab"); assert.equal(await page.evaluate(() => document.activeElement.type), "checkbox");
  await page.keyboard.press("Shift+Tab"); assert.equal(await page.evaluate(() => document.activeElement.textContent), "Done");
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  // Native typing, selection and paste do not trigger menu accelerators.
  await page.evaluate(() => { Object.assign(window.onlineApp.cfg, { MAXPLAYERS: 2, INITIAL_CASH: 100000, MAXROUNDS: 2, PLAY_ORDER: "ROUND-ROBIN", SOUND: "OFF", FALLING_TANKS: "OFF" }); });
  await click("Start"); await click("Local");
  const nameInput = page.getByRole("textbox", { name: "Name:" });
  await nameInput.fill("Alice"); await nameInput.press("Home"); await nameInput.press("ArrowRight"); await nameInput.press("Delete"); await nameInput.press("l");
  assert.equal(await nameInput.inputValue(), "Alice");
  await click("Computer"); assert.ok(await page.getByRole("radiogroup").isVisible()); assert.equal(await nameInput.isVisible(), false);
  await click("Person"); await click("Tank design 2"); await shot("setup");
  await click("Done"); await nameInput.fill("Bob"); await click("Done");
  assert.equal(await page.evaluate(() => window.onlineApp.top.constructor.name), "ShopScreen");
  const cash = await page.evaluate(() => window.onlineApp.top.tank.cash);
  await page.getByRole("button", { name: /^Baby Nuke, owned/ }).click(); await click("Update");
  assert.ok(await page.evaluate(() => window.onlineApp.top.tank.cash) < cash);
  await click("Miscellaneous");
  await page.getByRole("button", { name: /^Battery, owned/ }).click(); await click("Update");
  await shot("shop");
  await click("Inventory"); await shot("inventory"); await click("Done");
  await click("Done"); await click("Done");
  assert.equal(await page.evaluate(() => window.onlineApp.onlineScreen), "battle");
  assert.equal(await page.locator("[data-ui-screen]").count(), 0);
  await page.keyboard.press("F1"); await settled(); await shot("system");
  await click("Save Game");
  const file = page.getByRole("textbox", { name: "File:" });
  await file.fill("ui-check"); await click("Save");
  await page.evaluate(() => window.onlineApp._act("push:system")); await settled(); await click("Save Game");
  await file.fill("ui-check"); await click("Save");
  assert.ok(await page.getByText('File "ui-check.sav" exists. Delete it?', { exact: false }).count() || await page.getByRole("button", { name: "No", exact: true }).isVisible());
  await shot("overwrite"); await click("No"); assert.ok(await file.isVisible());
  await page.keyboard.press("Escape"); await settled();
  // A nested battery dialog rebuilds its parent; restore focus to the same action.
  await page.evaluate(async () => {
    const app = window.onlineApp;
    while (app.stack.length > 1) app.pop();
    const w = await import("/src/weapons.ts");
    app.gs.current_shooter.health = 70; app.gs.current_shooter.inventory[w.SLOT_BATTERY] = 3;
    app._act("push:control");
  });
  await settled(); await click("Batteries: 3 (discharge +10)");
  await click("Increase Batteries to discharge:"); await click("Ok");
  assert.equal(await page.evaluate(() => window.onlineApp.gs.current_shooter.health), 90);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.uiAction), "discharge");
  await shot("tank-controls"); await click("Quit");
  // Sell, reassign and team dialogs use the same HTML adapter and real mutations.
  await page.evaluate(async () => { const app = window.onlineApp; const s = await import("/src/screens.ts"); const w = await import("/src/weapons.ts"); app.push(new s.SellScreen(app.gs, app.gs.current_shooter, w.SLOT_BATTERY, app.w, app.h)); });
  await settled(); const sellCash = await page.evaluate(() => window.onlineApp.gs.current_shooter.cash);
  await shot("sell"); await click("Accept");
  assert.ok(await page.evaluate(() => window.onlineApp.gs.current_shooter.cash) > sellCash);
  await page.evaluate(async () => { const app = window.onlineApp; const i = await import("/src/ingame.ts"); app.push(new i.ReassignPlayersScreen(app.gs)); });
  await settled(); await page.getByRole("textbox", { name: "Player 1 name", exact: true }).fill("Alicia"); await shot("reassign"); await click("Done");
  assert.equal(await page.evaluate(() => window.onlineApp.gs.tanks[0].name), "Alicia");
  await page.evaluate(async () => { const app = window.onlineApp; const s = await import("/src/screens.ts"); app.push(new s.ConfigureTeamsScreen(app.gs, app.w, app.h)); });
  await settled(); await click("Increase Team for Alicia"); await shot("teams"); await click("Done");
  assert.equal(await page.evaluate(() => window.onlineApp.gs.tanks[0].team_id), 1);
  // Restore errors stay visible; successful restore uses the persisted game.
  await page.evaluate(() => window.onlineApp._act("restore_game")); await settled();
  await file.fill("missing"); await click("Restore"); assert.ok(await page.getByRole("status").filter({ hasText: /missing/ }).isVisible());
  await file.fill("ui-check"); await click("Restore");
  assert.equal(await page.evaluate(() => window.onlineApp.gs.tanks[0].name), "Alice");
  // Charge controls are HTML and keyboard navigation cannot fire through them.
  await page.evaluate(() => { window.onlineApp.gs.plasma_charge = { value: 1, max: 3 }; });
  await page.getByRole("dialog", { name: "Plasma Blast — Batteries" }).waitFor();
  await page.keyboard.press("Tab"); assert.ok(await page.evaluate(() => !!window.onlineApp.gs.plasma_charge));
  await page.getByRole("button", { name: "3", exact: true }).click();
  assert.equal(await page.evaluate(() => window.onlineApp.gs.plasma_charge.value), 3);
  await shot("plasma"); await click("Cancel");
  // Rankings and final results use tables; game state and ordering come from the model.
  await page.evaluate(() => window.onlineApp._act("round_end")); await settled();
  assert.equal(await page.getByRole("table").count(), 1); await shot("rankings"); await click("Go");
  await page.evaluate(() => { const app = window.onlineApp; while (app.stack.length > 1) app.pop(); app._act("game_over"); }); await settled();
  assert.equal(await page.getByRole("table").count(), 1); await shot("final"); await click("Go");
  // Simultaneous key capture is native keyboard input, with the existing duplicate-key guard.
  await page.evaluate(() => { const app = window.onlineApp; app.cfg.PLAY_MODE = "SIMULTANEOUS"; app.startLocal(); });
  const capture = page.locator(".ui-capture").first(); await capture.click(); await page.keyboard.press("q");
  assert.equal(await page.evaluate(() => window.onlineApp.top.sim_keys[0]), "Q");
  await shot("key-bindings");
  await page.evaluate(() => { window.onlineApp._act("to_menu"); window.onlineApp.cfg.PLAY_MODE = "SEQUENTIAL"; });
  // Narrow layouts keep all controls reachable without horizontal page scrolling.
  await page.evaluate(() => window.onlineApp._act("to_menu")); await settled();
  await page.setViewportSize({ width: 390, height: 844 });
  await click("Economics..."); await shot("mobile-options");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const done = page.getByRole("button", { name: "Done", exact: true }); await done.scrollIntoViewIfNeeded(); await done.click(); await settled();
  await click("Start"); await click("Local"); await shot("mobile-setup");
  assert.ok(await nameInput.isVisible());
  await page.setViewportSize({ width: 800, height: 480 }); await shot("short-setup"); await click("Done"); await click("Done");
  await shot("short-shop");
  assert.deepEqual(errors, []);
  console.log("HTML UI: local flow, native editing, focus, nested dialogs, shop, inventory, saves, and responsive layouts passed.");
} finally { await browser?.close(); server?.kill(); }
