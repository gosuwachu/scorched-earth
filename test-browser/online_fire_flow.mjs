import assert from "node:assert/strict";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { checkPanelLayout } from "./online_panel.mjs";
import { existsSync } from "node:fs";
import { openHostMenu, closeHostMenu, settledDialogs } from "./dialogs.mjs";

// Focused firing flows. Run once each with: synchronous, targeting, plasma, simultaneous.
// Engine-mode fixture: the online setup currently exposes only sequential and
// simultaneous play. Seed the retained synchronous engine path explicitly.
// Run against the same development LAN server as online.mjs.
const scenario = process.argv[2] || "synchronous";
assert.ok(["synchronous", "targeting", "plasma", "simultaneous"].includes(scenario));
const base = process.env.ONLINE_TEST_URL || "http://127.0.0.1:4317";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || ["/usr/bin/chromium", "/usr/bin/google-chrome"].find(existsSync),
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});
const until = async (fn) => {
  for (let i = 0; i < 250; i++) { if (await fn()) return; await new Promise((r) => setTimeout(r, 80)); }
  throw new Error(`Timed out waiting for ${scenario} firing state`);
};
const click = async (p, name) => { await settledDialogs(p); await p.getByRole("button", { name, exact: true }).click(); };
try {
  const host = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await host.goto(`${base}/test-browser/online_host.html`);
  await host.waitForFunction(() => !!window.onlineApp);
  await host.evaluate((scenario) => {
    Object.assign(window.onlineApp.cfg, { PLAY_MODE: scenario === "simultaneous" ? "SIMULTANEOUS" : "SEQUENTIAL", PLAY_ORDER: "ROUND-ROBIN", SOUND: "OFF", INITIAL_CASH: 100000, FALLING_TANKS: "OFF", MAX_WIND: 0 });
    window.onlineApp._act("start_game");
  }, scenario);
  await click(host, "Online");
  const link = await host.getByRole("textbox", { name: "Join link", exact: true }).inputValue();
  const phones = [];
  for (const name of ["Alice", "Bob"]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await page.addInitScript(() => {
      const Socket = window.WebSocket;
      window.WebSocket = class extends Socket { constructor(...args) { super(...args); window.onlineSocket = this; } };
    });
    await page.goto(`${base}/${new URL(link).search}`);
    await page.getByPlaceholder("Your name").fill(name); await click(page, "Ready"); phones.push(page);
  }
  const [a, b] = phones;
  await click(host, "Start online game");
  await click(a, "Done"); await click(b, "Done");
  const fire = (p) => p.locator('button[data-fire-label="Fire"]');
  await until(() => fire(a).isEnabled());
  await host.evaluate((scenario) => {
    const gs = window.onlineApp.gs;
    gs.tanks.forEach((t) => { t.angle = 90; t.power = 500; t.inventory[1] = 5; t.selected_weapon = 1; });
    if (scenario === "synchronous") { gs.cfg.PLAY_MODE = "SYNCHRONOUS"; gs._sync_begin_round(); }
    if (scenario === "plasma") { gs.tanks[0].selected_weapon = 31; gs.tanks[0].inventory[31] = 5; gs.tanks[0].inventory[39] = 5; }
    if (scenario === "targeting") { gs.tanks[0].selected_guidance = 37; gs.tanks[0].inventory[37] = 2; }
    window.fireAttempts = 0;
    const simFire = gs.sim_fire.bind(gs);
    gs.sim_fire = (...args) => { window.fireAttempts++; return simFire(...args); };
    window.fired = 0;
    const original = gs.fire.bind(gs);
    gs.fire = (...args) => { const shots = original(...args); window.fired += shots.length; return shots; };
  }, scenario);
  await until(async () => (await a.locator(".lan-battle-weapon").innerText()).startsWith(scenario === "plasma" ? "Plasma Blast" : "Missile"));
  if (scenario !== "synchronous") {
    await fire(a).click({ delay: 700 });
    if (scenario === "targeting" || scenario === "plasma") {
      const id = scenario === "targeting" ? "target-fire" : "plasma-fire";
      if (scenario === "targeting") await a.getByRole("button", { name: /^\d+: Bob$/ }).click();
      const confirmation = a.locator(`[data-control-id="${id}"] button`);
      await until(() => confirmation.isEnabled());
      await checkPanelLayout(a, fileURLToPath(new URL("../", import.meta.url)), scenario);
      await confirmation.tap();
      await a.waitForTimeout(150);
      assert.equal(await host.evaluate(() => window.fired), 0, "Short confirmation tap does not fire");
      await confirmation.click({ delay: 700 });
      await until(async () => await host.evaluate(() => window.fired) > 0);
      const ammo = await host.evaluate((scenario) => window.onlineApp.gs.tanks[0].inventory[scenario === "plasma" ? 31 : 1], scenario);
      assert.equal(ammo, 4, "Final confirmation spends exactly one weapon");
      if (scenario === "targeting") assert.equal(await host.evaluate(() => window.onlineApp.gs.tanks[0].inventory[37]), 1);
    } else {
      await until(async () => await host.evaluate(() => window.fired) === 1);
      assert.equal(await host.evaluate(() => window.fireAttempts), 1);
      await fire(a).hover(); await a.mouse.down();
      await until(async () => await fire(a).getAttribute("data-fire-state") === "ready");
      assert.equal(await host.evaluate(() => window.fireAttempts), 1, "Holding does not repeat a shot");
      await a.mouse.up();
      await until(async () => await host.evaluate(() => window.fireAttempts) === 2);
    }
    console.log(`PASS: ${scenario} deliberate firing and no accidental/repeated shots`);
  } else {
    const locks = () => host.evaluate(() => Object.keys(window.onlineApp.gs._sync_locks).length);
    const hold = async () => { await fire(a).hover(); await a.mouse.down(); };
    await hold(); await openHostMenu(host);
    await until(() => fire(a).isDisabled()); await closeHostMenu(host);
    await until(() => fire(a).isEnabled()); await a.mouse.up(); assert.equal(await locks(), 0);
    await hold(); await a.evaluate(() => window.onlineSocket.close());
    await until(() => a.locator(".lan-status").innerText().then((s) => s.includes("Connection lost")));
    await until(() => fire(a).isEnabled()); await a.mouse.up(); assert.equal(await locks(), 0);
    await fire(a).tap(); assert.equal(await locks(), 0);
    await fire(a).focus(); await a.keyboard.press("Enter");
    const confirm = a.getByRole("dialog", { name: "Confirm shot" });
    await confirm.waitFor(); assert.equal(await locks(), 0);
    await confirm.getByRole("button", { name: "Fire", exact: true }).click();
    await until(async () => await locks() === 1);
    assert.equal(await host.evaluate(() => window.fired), 0, "First player only locks their shot");
    await until(() => fire(b).isEnabled());
    const box = await fire(b).boundingBox();
    const touch = await b.context().newCDPSession(b);
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
    await until(async () => await fire(b).getAttribute("data-fire-state") === "ready");
    assert.equal(await host.evaluate(() => window.fired), 0, "Completed hold alone never launches the volley");
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await until(async () => await host.evaluate(() => window.fired) === 2);
    await b.waitForTimeout(200);
    assert.equal(await host.evaluate(() => window.fired), 2, "Exactly one shot per player");
    assert.deepEqual(await host.evaluate(() => window.onlineApp.gs.tanks.map((t) => t.inventory[1])), [4, 4]);
    console.log("PASS: synchronous shots, actual touch release, accessible confirmation, pause and reconnect cancel pending holds");
  }
} finally { await browser.close(); }
