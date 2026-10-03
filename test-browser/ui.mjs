// Real DOM interaction checks for the local UI and its shared component library.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkOptionHelp } from "./option_help.mjs";
import { checkGuidance } from "./guidance_ui.mjs";
import { checkMenuLayout, checkPlayerGrid } from "./menu_ui.mjs";
import { checkSetupDialogs, settledDialogs } from "./dialogs.mjs";
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
  const settled = () => settledDialogs(page);
  const click = async (name) => { await settled(); await page.getByRole("button", { name, exact: true }).click(); await settled(); };
  const shot = async (name) => page.screenshot({ path: `${root}/test-browser/out/ui-${name}.png` });
  mkdirSync(`${root}/test-browser/out`, { recursive: true });
  assert.equal(await page.getByRole("group", { name: /^(Players|Rounds):$/ }).count(), 0);
  await checkMenuLayout(page);
  await checkSetupDialogs(page, shot);
  await shot("menu");
  await page.keyboard.press("F11");
  await page.waitForFunction(() => document.fullscreenElement === document.documentElement);
  assert.ok(await page.getByRole("button", { name: "Start", exact: true }).isVisible());
  await page.keyboard.press("F11"); await page.waitForFunction(() => !document.fullscreenElement);
  // Every option screen uses native controls and returns focus to its opener.
  for (const name of ["Sound", "Hardware", "Economics", "Landscape", "Physics", "Play Options", "Weapons"]) {
    await click(name);
    assert.equal(await page.locator("dialog[open]").count(), 1);
    await shot(name.toLowerCase().replace(/[^a-z]/g, ""));
    await page.keyboard.press("Escape"); await settled();
    assert.equal(await page.locator("dialog[open]").count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement.textContent), name);
  }
  await page.getByRole("button", { name: "Sound", exact: true }).focus();
  await page.keyboard.press("o"); await settled();
  assert.ok(await page.getByRole("dialog", { name: "Sound", exact: true }).isVisible());
  await page.keyboard.press("Escape"); await settled();
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "Sound");
  await checkOptionHelp(page, { click, settled, shot });
  await click("Play Options");
  const tunneling = page.getByRole("checkbox", { name: "Tunneling", exact: true });
  assert.ok(await tunneling.isChecked(), "tunneling defaults ON");
  await tunneling.uncheck();
  assert.equal(await page.evaluate(() => window.onlineApp.cfg.TUNNELLING), "OFF");
  assert.equal(await page.evaluate(async () => {
    const { Config } = await import("/src/config.ts");
    return Config.load(window.onlineApp.cfg.save()).TUNNELLING;
  }), "OFF", "explicit OFF survives save/load");
  await tunneling.check();
  assert.equal(await page.evaluate(() => window.onlineApp.cfg.TUNNELLING), "ON");
  await shot("tunneling"); await click("Done");
  await click("About"); assert.ok(await page.getByText("Register Scorched Earth", { exact: true }).isVisible()); await click("OK");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await click("Sound"); assert.equal(await page.evaluate(() => window.onlineApp.transitioning), false);
  await page.keyboard.press("Tab"); assert.equal(await page.evaluate(() => document.activeElement.type), "checkbox");
  await page.keyboard.press("Shift+Tab"); assert.equal(await page.evaluate(() => document.activeElement.textContent), "Done");
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  // Match settings live in the mode/local dialogs; rounds reject invalid integers.
  await page.evaluate(() => { Object.assign(window.onlineApp.cfg, { MAXPLAYERS: 2, INITIAL_CASH: 100000, MAXROUNDS: 2, PLAY_ORDER: "ROUND-ROBIN", SOUND: "OFF", FALLING_TANKS: "OFF" }); });
  const newGame = page.getByRole("dialog", { name: "New game", exact: true });
  const localGame = page.getByRole("dialog", { name: "Local game", exact: true });
  const rounds = page.getByRole("spinbutton", { name: "Rounds", exact: true });
  const players = localGame.getByRole("group", { name: "Players", exact: true });
  const playerCount = (count) => players.getByRole("radio", { name: String(count), exact: true });
  await click("Start");
  assert.equal(await rounds.inputValue(), "2");
  assert.equal(await players.count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "Local");
  await page.keyboard.press("Shift+Tab"); assert.ok(await rounds.evaluate((node) => node === document.activeElement));
  await page.keyboard.press("Shift+Tab"); assert.equal(await page.evaluate(() => document.activeElement.textContent), "Back");
  await page.keyboard.press("Tab"); assert.ok(await rounds.evaluate((node) => node === document.activeElement));
  for (const value of ["", "0", "1001", "1.5"]) {
    await rounds.fill(value); await click("Local"); await click("Online");
    assert.ok(await newGame.isVisible());
    assert.equal(await page.evaluate(() => window.onlineApp.cfg.MAXROUNDS), 2);
  }
  for (const value of ["1", "1000", "2"]) {
    await rounds.fill(value);
    assert.equal(await page.evaluate(() => window.onlineApp.cfg.MAXROUNDS), Number(value));
  }
  await shot("new-game");
  // Connecting freezes the settings; a failed connection leaves them editable.
  let resolveRequest;
  const requested = new Promise((resolve) => { resolveRequest = resolve; });
  await page.route("**/api/lan", (route) => resolveRequest(route));
  await click("Online");
  const request = await requested;
  assert.ok(await rounds.isDisabled());
  assert.ok(await newGame.getByRole("button", { name: "Back", exact: true }).isDisabled());
  await page.keyboard.press("Escape"); assert.ok(await newGame.isVisible());
  await request.fulfill({ status: 503, body: "Unavailable" });
  await newGame.getByRole("status").filter({ hasText: /Local play remains available/ }).waitFor();
  assert.ok(await rounds.isEnabled());
  assert.equal(await rounds.inputValue(), "2");
  await page.unroute("**/api/lan");
  for (const cancel of ["Back", "Escape"]) {
    if (cancel === "Back") await click("Back"); else { await page.keyboard.press("Escape"); await settled(); }
    assert.equal(await page.locator("dialog[open]").count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement.textContent), "Start");
    await click("Start"); assert.equal(await rounds.inputValue(), "2");
  }
  await click("Local");
  assert.equal(await rounds.count(), 0);
  assert.ok(await playerCount(2).isChecked());
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "Continue");
  await checkPlayerGrid(page);
  await playerCount(3).check();
  for (const cancel of ["Back", "Escape"]) {
    if (cancel === "Back") await click("Back"); else { await page.keyboard.press("Escape"); await settled(); }
    assert.equal(await page.locator("dialog[open]").count(), 0);
    assert.equal(await page.evaluate(() => document.activeElement.textContent), "Start");
    await click("Start"); await click("Local"); assert.ok(await playerCount(3).isChecked());
  }
  for (let count = 2; count <= 10; count++) {
    // Click the label text, away from the native radio itself.
    await players.locator("label span").filter({ hasText: new RegExp(`^${count}$`) }).click();
    assert.ok(await playerCount(count).isChecked());
    assert.equal(await players.locator("input:checked").count(), 1);
    assert.equal(await page.evaluate(() => window.onlineApp.cfg.MAXPLAYERS), count);
  }
  await playerCount(3).check();
  await localGame.getByRole("button", { name: "Continue", exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  assert.ok(await playerCount(3).evaluate((node) => node === document.activeElement));
  await page.keyboard.press("Shift+Tab"); assert.equal(await page.evaluate(() => document.activeElement.textContent), "Back");
  await page.keyboard.press("Tab");
  assert.ok(await playerCount(3).evaluate((node) => node === document.activeElement), "Tab wraps to the selected radio");
  await page.keyboard.press("ArrowRight"); assert.ok(await playerCount(4).isChecked());
  assert.equal(await page.evaluate(() => window.onlineApp.cfg.MAXPLAYERS), 4);
  await page.keyboard.press("ArrowLeft"); assert.ok(await playerCount(3).isChecked());
  await playerCount(5).focus(); await page.keyboard.press("Space"); assert.ok(await playerCount(5).isChecked());
  await playerCount(3).check();
  await page.keyboard.press("Tab"); assert.equal(await page.evaluate(() => document.activeElement.textContent), "Continue");
  await shot("local-game");
  await playerCount(3).press("Enter"); await settled();
  assert.equal(await page.evaluate(() => window.onlineApp.top.player_index), 0);
  assert.ok(await page.getByRole("heading", { name: "Player 1 (of 3)", exact: true }).isVisible());
  // Native typing, selection and paste do not trigger menu accelerators.
  const nameInput = page.getByRole("textbox", { name: "Name:" });
  await nameInput.fill("Alice"); await nameInput.press("Home"); await nameInput.press("ArrowRight"); await nameInput.press("Delete"); await nameInput.press("l");
  assert.equal(await nameInput.inputValue(), "Alice");
  await click("Computer"); assert.ok(await page.getByRole("radiogroup").isVisible()); assert.equal(await nameInput.isVisible(), false);
  await click("Person"); await click("Tank design 2"); await shot("setup");
  await click("Done"); await nameInput.fill("Bob"); await click("Done");
  assert.ok(await page.getByRole("heading", { name: "Player 3 (of 3)", exact: true }).isVisible());
  await nameInput.fill("Charlie"); await click("Done");
  assert.equal(await page.evaluate(() => window.onlineApp.top.constructor.name), "ShopScreen");
  for (const name of ["^", "v"]) assert.equal(await page.getByRole("button", { name, exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => window.onlineApp.gs.tanks.length), 3);
  assert.equal(await page.evaluate(() => window.onlineApp.gs.cfg.MAXROUNDS), 2);
  const cash = await page.evaluate(() => window.onlineApp.top.tank.cash);
  await page.getByRole("button", { name: /^Baby Nuke, owned/ }).click(); await click("Update");
  assert.ok(await page.evaluate(() => window.onlineApp.top.tank.cash) < cash);
  await click("Miscellaneous");
  await page.getByRole("button", { name: /^Battery, owned/ }).click(); await click("Update");
  await shot("shop");
  await click("Inventory"); await shot("inventory"); await click("Done");
  await click("Done"); await click("Done"); await click("Done");
  assert.equal(await page.evaluate(() => window.onlineApp.onlineScreen), "battle");
  assert.equal(await page.locator("[data-ui-screen]").count(), 0);
  // The first simulation frame selects the shooter; menus pause that frame.
  await page.waitForFunction(() => window.onlineApp.gs.phase === "aim" && !!window.onlineApp.gs.current_shooter);
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
  // Shield browsing preserves stock and focus; only Engage deploys the choice.
  await page.evaluate(async () => {
    const app = window.onlineApp, tank = app.gs.current_shooter;
    const w = await import("/src/weapons.ts");
    for (const slot of w.SHIELD_SLOTS) tank.inventory[slot] = 0;
    tank.shield_item = tank.shield_hp = 0;
    tank.shield_push = tank.shield_deflect = tank.shield_laserproof = tank.shield_failproof = false;
    app._act("push:control");
  });
  await settled();
  assert.equal(await page.getByRole("button", { name: "Launch", exact: true }).count(), 0);
  const shields = page.getByRole("group", { name: "Shields", exact: true });
  const shieldOutput = shields.locator("output");
  const shieldState = () => page.evaluate(async () => {
    const t = window.onlineApp.gs.current_shooter, w = await import("/src/weapons.ts");
    return { item: t.shield_item, hp: t.shield_hp, stock: w.SHIELD_SLOTS.map((slot) => t.inventory[slot]) };
  });
  for (const action of ["Increase Shields", "Decrease Shields"]) {
    await click(action);
    assert.equal(await shieldOutput.textContent(), "None");
    assert.deepEqual(await shieldState(), { item: 0, hp: 0, stock: [0, 0, 0, 0, 0] });
  }
  await click("Quit");
  await page.evaluate(async () => {
    const app = window.onlineApp, w = await import("/src/weapons.ts");
    app.gs.current_shooter.inventory[w.SLOT_FORCE_SHIELD] = 1;
    app.gs.current_shooter.inventory[w.SLOT_SUPER_MAG] = 1;
    app._act("push:control");
  });
  await click("Increase Shields");
  assert.equal(await shieldOutput.textContent(), "Force Shield");
  assert.deepEqual(await shieldState(), { item: 0, hp: 0, stock: [0, 0, 1, 0, 1] });
  await click("Increase Shields");
  assert.equal(await shieldOutput.textContent(), "Super Mag");
  await click("Quit");
  assert.deepEqual(await shieldState(), { item: 0, hp: 0, stock: [0, 0, 1, 0, 1] });
  const openControls = async () => {
    await page.evaluate(() => window.onlineApp._act("push:control")); await settled();
  };
  await openControls();
  assert.equal(await shieldOutput.textContent(), "None");
  await click("Increase Shields");
  await page.keyboard.press("Enter"); await settled();
  assert.deepEqual(await shieldState(), { item: 42, hp: 100, stock: [0, 0, 0, 0, 1] });
  assert.equal(await page.getByRole("dialog", { name: "Tank Control Panel", exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => window.onlineApp.gs.projectiles.length), 0);
  // Reopening must display a damaged active shield even with no spares.
  await page.evaluate(() => { window.onlineApp.gs.current_shooter.shield_hp = 37; });
  await openControls();
  assert.equal(await shieldOutput.textContent(), "Force Shield");
  assert.deepEqual(await shieldState(), { item: 42, hp: 37, stock: [0, 0, 0, 0, 1] });
  const increaseShields = page.getByRole("button", { name: "Increase Shields", exact: true });
  await increaseShields.focus(); await page.keyboard.press("ArrowRight");
  assert.equal(await shieldOutput.textContent(), "Super Mag");
  assert.deepEqual(await shieldState(), { item: 42, hp: 37, stock: [0, 0, 0, 0, 1] });
  assert.ok(await increaseShields.evaluate((node) => node === document.activeElement));
  await shot("shield-inventory");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await shieldOutput.textContent(), "Force Shield");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await shieldOutput.textContent(), "None");
  assert.ok(await increaseShields.evaluate((node) => node === document.activeElement));
  await page.keyboard.press("ArrowRight");
  assert.equal(await shieldOutput.textContent(), "Force Shield");
  await click("Engage");
  assert.deepEqual(await shieldState(), { item: 42, hp: 37, stock: [0, 0, 0, 0, 1] });
  // Escape discards a different pending shield; Engage spends the final choice.
  await openControls(); await click("Increase Shields");
  await page.keyboard.press("Escape"); await settled();
  assert.deepEqual(await shieldState(), { item: 42, hp: 37, stock: [0, 0, 0, 0, 1] });
  await openControls(); await click("Increase Shields"); await click("Engage");
  assert.deepEqual(await shieldState(), { item: 44, hp: 200, stock: [0, 0, 0, 0, 0] });
  // Choosing None also waits for Engage; Quit preserves the active shield.
  await openControls(); await click("Decrease Shields");
  assert.equal(await shieldOutput.textContent(), "None");
  await click("Quit");
  assert.deepEqual(await shieldState(), { item: 44, hp: 200, stock: [0, 0, 0, 0, 0] });
  await openControls(); await click("Decrease Shields"); await click("Engage");
  assert.deepEqual(await shieldState(), { item: 0, hp: 0, stock: [0, 0, 0, 0, 0] });
  assert.deepEqual(await page.evaluate(() => {
    const t = window.onlineApp.gs.current_shooter;
    return [t.shield_push, t.shield_deflect, t.shield_laserproof, t.shield_failproof];
  }), [false, false, false, false]);
  await checkGuidance(page, { shot });
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
  for (const [width, height] of [[320, 568], [390, 844], [800, 480]]) {
    await page.setViewportSize({ width, height });
    // Let the canvas ResizeObserver reposition the menu before measuring it.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await checkMenuLayout(page); await shot(`menu-${width}x${height}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await click("Economics"); await shot("mobile-options");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const done = page.getByRole("button", { name: "Done", exact: true }); await done.scrollIntoViewIfNeeded(); await done.click(); await settled();
  await click("Start"); await shot("mobile-new-game");
  await page.setViewportSize({ width: 800, height: 480 }); await shot("short-new-game");
  await page.setViewportSize({ width: 390, height: 844 }); await rounds.press("Enter"); await settled(); await checkPlayerGrid(page); await shot("mobile-local-game");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 800, height: 480 }); await checkPlayerGrid(page); await shot("short-local-game");
  await page.setViewportSize({ width: 320, height: 568 }); await checkPlayerGrid(page); await shot("narrow-local-game");
  await page.setViewportSize({ width: 390, height: 844 }); await playerCount(2).check(); await click("Continue"); await shot("mobile-setup");
  assert.ok(await nameInput.isVisible());
  await page.setViewportSize({ width: 800, height: 480 }); await shot("short-setup"); await click("Done"); await click("Done");
  await shot("short-shop");
  assert.deepEqual(errors, []);
  console.log("HTML UI: local flow, native editing, focus, nested dialogs, shop, inventory, saves, and responsive layouts passed.");
} finally { await browser?.close(); server?.kill(); }
