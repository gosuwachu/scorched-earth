import assert from "node:assert/strict";

export async function assertCompactTargetHud(page, local = true) {
  await page.waitForFunction(() => !!window.onlineApp.renderer.targetHud);
  const result = await page.evaluate(() => {
    const row = document.querySelector(".ui-target-hud"), layer = row.parentElement;
    const canvas = document.querySelector("#game"), c = canvas.getBoundingClientRect();
    const rect = (node) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const style = (node) => { const s = getComputedStyle(node); return { background: s.backgroundColor, border: s.borderTopWidth, shadow: s.boxShadow, pointer: s.pointerEvents }; };
    const scale = c.width / canvas.width, gs = window.onlineApp.gs;
    return { canvas: rect(canvas), scale, row: rect(row), rowStyle: style(row), layerStyle: style(layer),
      title: row.querySelector(".ui-target-action").textContent, instructions: row.querySelectorAll("p").length,
      children: [...row.children].filter((n) => !n.hidden).map(rect),
      button: rect(row.querySelector("button")), buttonHidden: row.querySelector("button").hidden,
      buttonStyle: style(row.querySelector("button")),
      labels: [...layer.querySelectorAll(".ui-target-tank")].map((node) => {
        const t = gs.tanks.find((t) => String(t.player_index) === node.dataset.targetTank);
        return { ...rect(node), tankTop: c.top + (t.y - 10) * scale, tankBottom: c.top + t.y * scale };
      }),
      readouts: ["power", "angle", "weapon"].flatMap((key) => {
        const r = gs._hud_hitboxes[key]; return r ? [{ left: c.left + r.x * scale, right: c.left + r.right * scale }] : [];
      }),
    };
  });
  for (const style of [result.layerStyle, result.rowStyle, result.buttonStyle]) {
    assert.equal(style.background, "rgba(0, 0, 0, 0)"); assert.equal(style.border, "0px"); assert.equal(style.shadow, "none");
  }
  assert.equal(result.rowStyle.pointer, "none"); assert.equal(result.buttonStyle.pointer, "auto");
  assert.equal(result.instructions, 0); assert.equal(result.title, "Choose target");
  assert.equal(result.buttonHidden, !local);
  assert.ok(Math.abs(result.row.y - result.canvas.y) < 1);
  assert.ok(result.row.height <= Math.max(22 * result.scale, 18) + 1);
  assert.ok(result.row.x >= result.canvas.x && result.row.right <= result.canvas.right + 1);
  if (local) assert.ok(result.button.height <= Math.max(20, 20 * result.scale));
  for (let i = 0; i < result.children.length; i++) {
    const child = result.children[i];
    assert.ok(child.y >= result.row.y - 1 && child.bottom <= result.row.bottom + 1, "target row must not wrap");
    assert.ok(child.x >= result.row.x - 1 && child.right <= result.row.right + 1);
    if (i) assert.ok(child.x >= result.children[i - 1].right - 1);
  }
  for (const r of result.readouts) assert.ok(r.right <= result.row.x || r.left >= result.row.right, "readout overlaps targeting");
  for (const label of result.labels) {
    assert.ok(label.y >= result.row.bottom, "tank label overlaps top bar");
    assert.ok(label.bottom <= label.tankTop || label.y >= label.tankBottom, "label obscures its tank");
  }
}

/** Real input/DOM checks; freeze flight only so launch state stays inspectable. */
export async function checkGuidance(page, { shot }) {
  await page.evaluate(() => {
    const gs = window.onlineApp.gs, t = gs.current_shooter;
    const update = gs.update, inventory = [...t.inventory];
    const saved = { name: t.name, selected_guidance: t.selected_guidance, selected_weapon: t.selected_weapon, angle: t.angle, power: t.power };
    const positions = gs.tanks.map((tank) => [tank.x, tank.y]);
    const cfg = { STATUS_BAR: gs.cfg.STATUS_BAR, ICON_BAR: gs.cfg.ICON_BAR };
    window.restoreGuidanceCheck = () => {
      gs.update = update; gs.pendingTarget = null; gs.projectiles = []; gs.phase = "aim";
      Object.assign(t, saved); t.inventory.splice(0, t.inventory.length, ...inventory); Object.assign(gs.cfg, cfg);
      gs.tanks.forEach((tank, i) => { [tank.x, tank.y] = positions[i]; });
    };
    gs.update = () => {};
    t.inventory[37] = 10; t.selected_guidance = 37; t.selected_weapon = 0;
    t.angle = 45;
    gs.cfg.STATUS_BAR = "OFF"; gs.cfg.ICON_BAR = "ON";
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
    assert.ok(await prompt.getByText("Choose target", { exact: true }).isVisible());
    assert.equal(await page.locator("canvas#game").evaluate((c) => getComputedStyle(c).cursor), "crosshair");
    assert.equal(await prompt.evaluate((node) => getComputedStyle(node).backgroundColor), "rgba(0, 0, 0, 0)");
    assert.equal(await prompt.evaluate((node) => getComputedStyle(node).borderTopWidth), "0px");
    assert.equal(await prompt.locator(".ui-target-tank").count(), 3);
    await assertCompactTargetHud(page);
    assert.ok(await prompt.locator(".ui-target-guidance").evaluate((node) => node.clientWidth >= node.scrollWidth), "guidance fits on desktop");
    await shot("guidance-target");
    // Names and targeting take precedence as the viewport becomes narrower.
    await page.evaluate(() => {
      const gs = window.onlineApp.gs, t = gs.current_shooter;
      t.name = "LongName"; t.selected_weapon = 18; t.inventory[18] = 9999;
      gs.tanks[1].x = gs.w / 2; gs.tanks[1].y = 90;
    });
    await page.setViewportSize({ width: 460, height: 780 });
    await page.waitForFunction(() => !window.onlineApp.renderer.targetHud?.showWeapon && window.onlineApp.renderer.targetHud?.showAim);
    await assertCompactTargetHud(page);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.waitForFunction(() => !window.onlineApp.renderer.targetHud?.showAim);
    await assertCompactTargetHud(page); await shot("guidance-narrow");
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.waitForFunction(() => window.onlineApp.renderer.targetHud?.showWeapon);
    await page.keyboard.press("F11");
    await page.waitForFunction(() => !!document.fullscreenElement);
    await assertCompactTargetHud(page); await shot("guidance-fullscreen");
    await page.keyboard.press("F11"); await page.waitForFunction(() => !document.fullscreenElement);
    await page.evaluate(() => { window.onlineApp.gs.cfg.ICON_BAR = "OFF"; });
    await page.waitForFunction(() => !window.onlineApp.renderer.targetHud?.showAim);
    await assertCompactTargetHud(page); await shot("guidance-no-hud");
    await page.evaluate(() => { window.onlineApp.gs.current_shooter.selected_weapon = 0; });
    const pendingAngle = await page.evaluate(() => window.onlineApp.gs.current_shooter.angle);
    await page.keyboard.press("ArrowLeft"); await page.keyboard.press("Space");
    assert.equal(await page.evaluate(() => window.onlineApp.gs.current_shooter.angle), pendingAngle);
    await page.keyboard.press("Escape");
    await prompt.waitFor({ state: "hidden" });
    assert.equal(await page.locator("dialog[open]").count(), 0);
    assert.equal(await page.evaluate(() => window.onlineApp.gs.current_shooter.inventory[37]), 10);
    assert.equal(await page.evaluate(() => window.onlineApp.renderer.targetHud), null);
    await page.evaluate(() => { window.onlineApp.gs.cfg.ICON_BAR = "ON"; });
    await page.waitForFunction(() => !!window.onlineApp.gs._hud_hitboxes.name && !!window.onlineApp.gs._hud_hitboxes.weapon);
    await start(); await prompt.getByRole("button", { name: "Cancel targeting" }).click();
    await prompt.waitFor({ state: "hidden" });
    await start(); await prompt.getByRole("button").focus(); await page.keyboard.press("Escape");
    await prompt.waitFor({ state: "hidden" });
    await page.evaluate(() => { window.onlineApp.gs.cfg.ICON_BAR = "OFF"; });
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
