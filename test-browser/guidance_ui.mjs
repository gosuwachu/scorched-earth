import assert from "node:assert/strict";

/** Real input/DOM checks; freeze flight only so launch state stays inspectable. */
export async function checkGuidance(page, { shot }) {
  await page.evaluate(() => {
    const gs = window.onlineApp.gs, t = gs.current_shooter;
    const update = gs.update, inventory = [...t.inventory];
    const saved = { selected_guidance: t.selected_guidance, selected_weapon: t.selected_weapon, angle: t.angle, power: t.power };
    const cfg = { STATUS_BAR: gs.cfg.STATUS_BAR, ICON_BAR: gs.cfg.ICON_BAR };
    window.restoreGuidanceCheck = () => {
      gs.update = update; gs.pendingTarget = null; gs.projectiles = []; gs.phase = "aim";
      Object.assign(t, saved); t.inventory.splice(0, t.inventory.length, ...inventory); Object.assign(gs.cfg, cfg);
    };
    gs.update = () => {};
    t.inventory[37] = 10; t.selected_guidance = 37; t.selected_weapon = 0;
    t.angle = 45;
    gs.cfg.STATUS_BAR = "OFF"; gs.cfg.ICON_BAR = "OFF";
  });
  const prompt = page.locator("[data-targeting]");
  const start = async (slot = 37) => {
    await page.evaluate((slot) => {
      const gs = window.onlineApp.gs;
      gs.projectiles = []; gs.phase = "aim";
      gs.current_shooter.selected_guidance = slot; gs.current_shooter.inventory[slot] = 10;
    }, slot);
    await page.keyboard.press("Space");
    await prompt.waitFor({ state: "visible" });
  };
  try {
    assert.equal(await prompt.isVisible(), false);
    const angle = await page.evaluate(() => window.onlineApp.gs.current_shooter.angle);
    await page.keyboard.press("ArrowLeft");
    await page.waitForFunction((before) => window.onlineApp.gs.current_shooter.angle > before, angle);
    await start();
    assert.ok(await prompt.getByText("Choose Target — Lazy Boy", { exact: true }).isVisible());
    assert.equal(await page.locator("canvas#game").evaluate((c) => getComputedStyle(c).cursor), "crosshair");
    assert.equal(await prompt.evaluate((node) => getComputedStyle(node).backgroundColor), "rgba(0, 0, 0, 0)");
    assert.equal(await prompt.evaluate((node) => getComputedStyle(node).borderTopWidth), "0px");
    assert.equal(await prompt.locator(".ui-target-tank").count(), 3);
    await shot("guidance-target");
    const pendingAngle = await page.evaluate(() => window.onlineApp.gs.current_shooter.angle);
    await page.keyboard.press("ArrowLeft"); await page.keyboard.press("Space");
    assert.equal(await page.evaluate(() => window.onlineApp.gs.current_shooter.angle), pendingAngle);
    await page.keyboard.press("Escape");
    await prompt.waitFor({ state: "hidden" });
    assert.equal(await page.locator("dialog[open]").count(), 0);
    assert.equal(await page.evaluate(() => window.onlineApp.gs.current_shooter.inventory[37]), 10);
    await start(); await prompt.getByRole("button", { name: "Cancel targeting" }).click();
    await prompt.waitFor({ state: "hidden" });
    await start(); await prompt.getByRole("button").focus(); await page.keyboard.press("Escape");
    await prompt.waitFor({ state: "hidden" });
    // All four targeted accessories use the same visible flow, even with HUD off.
    for (const slot of [34, 35, 36, 37]) {
      await start(slot);
      const box = await page.locator("#game").boundingBox();
      await page.mouse.click(box.x + box.width * .75, box.y + box.height * .45);
      await prompt.waitFor({ state: "hidden" });
      const result = await page.evaluate(() => {
        const gs = window.onlineApp.gs, t = gs.current_shooter;
        return { stock: t.inventory, selected: t.selected_guidance, point: gs.projectiles[0]?.guidance?.point };
      });
      assert.equal(result.stock[slot], 9); assert.equal(result.selected, null);
      assert.ok(result.point[0] > 0 && result.point[1] > 0);
    }
    // Numbers refer to the displayed left-to-right ordering.
    await start();
    const leftmost = await page.evaluate(() => {
      const t = window.onlineApp.gs.tanks.filter((t) => t.alive).sort((a, b) => a.x - b.x)[0];
      return [t.x, t.y];
    });
    await page.keyboard.press("1"); await prompt.waitFor({ state: "hidden" });
    assert.deepEqual(await page.evaluate(() => window.onlineApp.gs.projectiles[0].guidance.point), leftmost);
    await start();
    const box = await page.locator("#game").boundingBox();
    const size = await page.evaluate(() => [window.onlineApp.gs.w, window.onlineApp.gs.h]);
    await page.mouse.click(box.x + leftmost[0] / size[0] * box.width, box.y + leftmost[1] / size[1] * box.height, { button: "right" });
    await prompt.waitFor({ state: "hidden" });
    assert.deepEqual(await page.evaluate(() => window.onlineApp.gs.projectiles[0].guidance.point), leftmost);
    await page.evaluate(() => {
      const gs = window.onlineApp.gs;
      gs.phase = "aim"; gs.projectiles = []; gs.current_shooter.selected_guidance = 33; gs.current_shooter.inventory[33] = 1;
    });
    await page.keyboard.press("Space");
    await page.waitForFunction(() => window.onlineApp.gs.projectiles.length === 1);
    assert.equal(await prompt.isVisible(), false);
    assert.equal(await page.evaluate(() => window.onlineApp.gs.current_shooter.inventory[33]), 0);
  } finally { await page.evaluate(() => { window.restoreGuidanceCheck(); delete window.restoreGuidanceCheck; }); }
}
