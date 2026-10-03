import assert from "node:assert/strict";
import { openHostMenu, closeHostMenu } from "./dialogs.mjs";
import { massKillRound } from "./online_mass_kill.mjs";
import { checkPreciseAim, checkHealthPower, checkResults, checkWeaponSelector } from "./online_battle.mjs";

export async function checkSimultaneous({ host, a, b, base, root, click, enabled, until, pause }) {
  await host.evaluate(() => {
    Object.assign(window.onlineApp.cfg, { PLAY_MODE: "SIMULTANEOUS", MAXROUNDS: 2, SOUND: "OFF", INITIAL_CASH: 100000 });
    window.onlineApp._act("start_game");
  });
  await click(host, "Online");
  const link = host.getByRole("textbox", { name: "Join link", exact: true });
  await link.waitFor();
  const joinUrl = `${base}/${new URL(await link.inputValue()).search}`;
  await a.goto(joinUrl); await b.goto(joinUrl);
  await a.getByPlaceholder("Your name").fill("Alice"); await click(a, "Ready");
  await b.getByPlaceholder("Your name").fill("Bob"); await click(b, "Ready");
  await click(host, "Add computer");
  await until(() => enabled(host, "Start online game"), "simultaneous lobby");
  await click(host, "Start online game");
  // Purchasing stays turn-based and never asks either player to bind keys.
  await until(() => enabled(a, "Done"), "Alice simultaneous shopping");
  assert.equal(await host.evaluate(() => window.onlineApp.gs.cfg.PLAY_MODE), "SIMULTANEOUS");
  assert.equal(await enabled(b, "Done"), false);
  await click(a, "Done");
  await until(() => enabled(b, "Done"), "Bob simultaneous shopping");
  await click(b, "Done");
  await host.waitForFunction(() => window.onlineApp.gs.phase === "sim_live");
  await host.evaluate(() => {
    const gs = window.onlineApp.gs;
    for (const rec of Object.values(gs._sim)) rec.timer = 10000;
    gs.projectiles = []; gs.explosions = []; gs.death_queue = [];
    gs.tanks.forEach((t) => { t.angle = 90; t.power = 500; t.inventory[1] = 5; t.selected_weapon = 0; });
    window.simShots = [];
    const fire = gs.fire.bind(gs);
    gs.fire = (tank = null) => {
      const result = fire(tank);
      if (result.length) window.simShots.push({ owner: tank?.name, weapon: result[0].weapon.name });
      return result;
    };
  });
  await until(async () => await enabled(a, "Fire") && await enabled(b, "Fire"), "both controllers enabled");
  await checkPreciseAim({ host, page: a, until });
  await checkHealthPower({ host, page: a, until, root });
  assert.equal(await a.getByRole("button", { name: "Tank Control Panel", exact: true }).count(), 0);
  assert.equal(await b.getByRole("button", { name: "Inventory", exact: true }).count(), 0);
  const angles = () => host.evaluate(() => window.onlineApp.gs.tanks.map((t) => t.angle));
  const powers = () => host.evaluate(() => window.onlineApp.gs.tanks.map((t) => t.power));
  const hold = async (page, name) => {
    const box = await page.getByRole("button", { name, exact: true }).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  };
  await click(a, "← Angle"); await until(async () => (await angles())[0] > 90, "Alice tap");
  assert.deepEqual((await angles()).slice(1), [90, 90]);
  await hold(a, "← Angle"); await hold(b, "← Angle");
  await until(async () => { const x = await angles(); return x[0] > 100 && x[1] > 100; }, "overlapping angle holds");
  await openHostMenu(host);
  await until(async () => !await enabled(a, "Fire") && !await enabled(b, "Fire"), "both controllers pause");
  const pausedAngles = await angles();
  await pause(250);
  assert.deepEqual(await angles(), pausedAngles);
  await closeHostMenu(host);
  await until(async () => await enabled(a, "Fire") && await enabled(b, "Fire"), "both controllers resume");
  await pause(150);
  assert.deepEqual(await angles(), pausedAngles, "Old holds do not resume with the match");
  await a.mouse.up(); await b.mouse.up();
  await hold(a, "← Angle"); await hold(b, "← Angle");
  await a.mouse.up(); await pause(150);
  const stopped = (await angles())[0], moving = (await angles())[1];
  await until(async () => (await angles())[1] > moving + 5, "Bob continues after Alice releases");
  assert.equal((await angles())[0], stopped);
  await b.mouse.up();
  await hold(a, "↑ Power"); await hold(b, "↑ Power");
  await until(async () => { const x = await powers(); return x[0] > 550 && x[1] > 550; }, "overlapping power holds");
  await a.mouse.up(); await b.mouse.up();
  assert.equal((await powers())[2], 500);
  await click(a, "Next weapon");
  await until(async () => await host.evaluate(() => window.onlineApp.gs.tanks[0].selected_weapon) === 1, "Alice weapon");
  await checkWeaponSelector({ host, page: a, until });
  assert.equal(await host.evaluate(() => window.onlineApp.gs.tanks[1].selected_weapon), 0);
  await click(a, "Previous weapon");
  await until(async () => await host.evaluate(() => window.onlineApp.gs.tanks[0].selected_weapon) === 0, "Alice previous weapon");
  await checkWeaponSelector({ host, page: a, until });
  await host.keyboard.press("ArrowLeft"); await host.keyboard.press("Space");
  assert.equal(await host.evaluate(() => window.simShots.length), 0);
  await host.screenshot({ path: `${root}/test-browser/out/online-simultaneous-host.png` });
  await Promise.all([click(a, "Fire"), click(b, "Fire")]);
  await until(async () => await host.evaluate(() => window.simShots.some((s) => s.owner === "Alice") && window.simShots.some((s) => s.owner === "Bob")), "both phones fire");

  // Controlled positions keep these UI checks independent of random shot damage.
  await host.evaluate(() => {
    const gs = window.onlineApp.gs;
    gs.projectiles = []; gs.explosions = []; gs.death_queue = [];
    gs.tanks.forEach((t, i) => { t.x = 120 + i * 350; t.y = 600; t.angle = 90; t.power = 400; });
    const a = gs.tanks[0]; a.inventory[31] = 3; a.inventory[39] = 5; a.selected_weapon = 31;
  });
  // Clearing shots does not cancel soil settling already queued by an impact.
  // Fire is intentionally gated until that settling completes.
  await host.waitForFunction(() => !window.onlineApp.gs.sim_settling && !window.onlineApp.gs.soilDirty);
  await hold(b, "← Angle");
  await click(a, "Fire");
  const charge = a.getByRole("spinbutton", { name: "Batteries for Plasma", exact: true });
  await charge.waitFor();
  assert.equal(await host.evaluate(() => window.onlineApp.gs.plasma_charge), null);
  assert.equal(await b.getByRole("spinbutton", { name: "Batteries for Plasma", exact: true }).count(), 0);
  const bobBefore = (await angles())[1];
  await until(async () => (await angles())[1] > bobBefore + 5, "Bob aims during Alice's Plasma choice");
  assert.equal((await angles())[0], 90);
  await b.mouse.up();
  const bobShots = await host.evaluate(() => window.simShots.filter((s) => s.owner === "Bob").length);
  await click(b, "Fire");
  await until(async () => await host.evaluate(() => window.simShots.filter((s) => s.owner === "Bob").length) > bobShots, "Bob fires during Alice's Plasma choice");
  await charge.fill("2"); await charge.press("Tab");
  await until(async () => await host.evaluate(() => window.onlineApp.gs.sim_charges.get(window.onlineApp.gs.tanks[0])?.value) === 2, "private battery selection");
  await openHostMenu(host);
  const flight = () => host.evaluate(() => window.onlineApp.gs.projectiles.map((p) => [p.x, p.y, p.vx, p.vy]));
  const pausedFlight = await flight();
  assert.ok(pausedFlight.length > 0, "Bob's shot is in flight when the host pauses");
  await pause(300);
  assert.deepEqual(await flight(), pausedFlight, "Projectiles freeze while the host menu is open");
  assert.equal(await host.evaluate(() => window.onlineApp.gs.sim_charges.get(window.onlineApp.gs.tanks[0])?.value), 2);
  await closeHostMenu(host);
  await charge.waitFor();
  assert.equal(await charge.inputValue(), "2", "The pending Plasma choice survives pause and resume");
  await until(async () => JSON.stringify(await flight()) !== JSON.stringify(pausedFlight), "projectiles resume");
  await a.screenshot({ path: `${root}/test-browser/out/online-simultaneous-plasma.png`, fullPage: true });
  // Let Bob's resumed shot and soil settling finish before requesting another fire.
  await host.waitForFunction(() => {
    const gs = window.onlineApp.gs;
    return !gs.projectiles.length && !gs.explosions.length && !gs.sim_settling && !gs.soilDirty;
  });
  await click(a, "Fire Plasma");
  await until(async () => await host.evaluate(() => window.onlineApp.gs.tanks[0].inventory[31]) === 2, "Alice Plasma fires");
  assert.equal(await host.evaluate(() => window.onlineApp.gs.tanks[0].batteries), 3);

  await host.evaluate(() => { window.onlineApp.gs.projectiles = []; });
  await hold(b, "↑ Power");
  // Navigating away disconnects Alice; her browser token restores the same tank.
  await a.goto("about:blank");
  const beforeDisconnect = (await powers())[1];
  await until(async () => (await powers())[1] > beforeDisconnect + 20, "Bob continues while Alice disconnects");
  await a.goto(joinUrl);
  await until(() => enabled(a, "Fire"), "Alice reconnects to her tank");
  await b.mouse.up();
  assert.equal(await host.evaluate(() => window.onlineApp.gs.tanks.length), 3);
  assert.ok((await a.getByRole("heading", { level: 2 }).innerText()).startsWith("Alice"));
  await a.screenshot({ path: `${root}/test-browser/out/online-simultaneous-controller.png`, fullPage: true });
  await host.evaluate(() => { window.onlineApp.gs.tanks[0].alive = false; window.onlineApp.gs.tanks[0].health = 0; });
  await until(async () => !await enabled(a, "Fire"), "dead tank disabled");
  assert.equal(await enabled(b, "Fire"), true);
  await massKillRound({ host, guests: [a, b], click, until, root });
  await checkResults({ pages: [a, b], screen: "Round results", until });
  await click(host, "Go");
  await until(() => enabled(a, "Done"), "next round Alice shopping"); await click(a, "Done");
  await until(() => enabled(b, "Done"), "next round Bob shopping"); await click(b, "Done");
  await until(async () => await enabled(a, "Fire") && await enabled(b, "Fire"), "next round both controllers");
  // Losing the host connection freezes play but must leave its menu usable.
  await host.evaluate(() => window.onlineApp.online.connection.close());
  await host.waitForFunction(() => window.onlineApp.online.paused);
  await openHostMenu(host);
  await click(host, "Join link");
  await host.getByRole("dialog", { name: "Join / reconnect", exact: true }).waitFor();
  await click(host, "Close join link");
  await click(host, "Quit Game");
  await click(host, "Yes");
  await host.getByRole("button", { name: "Start", exact: true }).waitFor();
  assert.equal(await host.evaluate(() => window.onlineApp.cfg.PLAY_MODE), "SIMULTANEOUS");
  console.log("PASS: simultaneous phones, pause/resume, frozen flight, preserved Plasma, independent releases, reconnect, death, next round and disconnected host menu");
}
