import assert from "node:assert/strict";

/** Browser presentation/binding checks; these are not DOS comparison fixtures. */
export async function checkBattleControls({ host, a, b, root, until }) {
  const original = a.viewportSize();
  const saved = await host.evaluate(() => window.onlineApp.gs.tanks.slice(0, 2).map((t) => ({
    tank_icon: t.tank_icon, angle: t.angle, health: t.health, power: t.power,
  })));
  const canvas = (page) => page.locator(".lan-tank-preview canvas");
  await canvas(a).evaluate((node) => { window.battleCanvas = node; });
  for (const [index, page] of [a, b].entries()) {
    for (const design of [0, 1, 2, 3, 4, 5]) {
      for (const angle of [0, 45, 90, 135, 180]) {
        const expected = await host.evaluate(async ({ index, design, angle }) => {
          const { Surface, SRCALPHA } = await import("/src/pygame.ts");
          const { draw_tank } = await import("/src/sprites.ts");
          const { TEAM_RGB } = await import("/src/palette.ts");
          const t = window.onlineApp.gs.tanks[index];
          t.tank_icon = design; t.angle = angle;
          const surface = new Surface([48, 36], SRCALPHA);
          draw_tank(surface, 24, 32, design, TEAM_RGB[index], angle, { scale: 2 });
          return surface.canvas.toDataURL();
        }, { index, design, angle });
        await until(async () => await canvas(page).evaluate((node) => node.toDataURL()) === expected,
          `player ${index} design ${design}, angle ${angle} matches the game sprite`);
        assert.equal(await page.getByRole("meter", { name: "Angle", exact: true }).getAttribute("aria-valuenow"), String(angle));
      }
    }
  }
  assert.ok(await canvas(a).evaluate((node) => node === window.battleCanvas), "State updates preserve the canvas");
  await host.evaluate(() => Object.assign(window.onlineApp.gs.tanks[0], { tank_icon: 3, angle: 45, health: 65, power: 600 }));
  await until(async () => await a.getByRole("meter", { name: "Health" }).getAttribute("aria-valuenow") === "65", "damaged health reaches the controller");
  assert.equal(await a.getByRole("meter", { name: "Health" }).getAttribute("aria-valuetext"), "Health 65/100");
  assert.equal(await a.locator(".lan-health .lan-meter-fill").evaluate((node) => node.style.width), "65%");
  assert.equal(await a.getByRole("meter", { name: "Power" }).getAttribute("aria-valuenow"), "600");
  const preview = await canvas(a).boundingBox(), health = await a.locator(".lan-health").boundingBox();
  assert.ok(health.y + health.height <= preview.y, "Health stays above the turret");
  for (const viewport of [
    { width: 320, height: 568 }, { width: 390, height: 844 },
    { width: 844, height: 390 }, { width: 1440, height: 900 },
  ]) {
    await a.setViewportSize(viewport);
    const layout = await a.locator(".lan-battle").evaluate((battle) => {
      const root = document.querySelector(".lan-controller").getBoundingClientRect();
      return {
        width: root.width, height: root.height,
        overflow: document.documentElement.scrollWidth > innerWidth,
        scroll: document.documentElement.scrollHeight > innerHeight + 1,
        targets: [...battle.querySelectorAll("button, summary")].filter((node) => node.checkVisibility()).map((node) => {
          const r = node.getBoundingClientRect();
          return { text: node.textContent, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
        }),
      };
    });
    await a.screenshot({ path: `${root}/test-browser/out/online-battle-${viewport.width}x${viewport.height}.png`, fullPage: true });
    assert.equal(layout.overflow, false, `No horizontal overflow at ${viewport.width}x${viewport.height}`);
    assert.equal(layout.scroll, false, `Battle fits ${viewport.width}x${viewport.height}: ${JSON.stringify(layout)}`);
    assert.equal(layout.width, viewport.width);
    assert.equal(layout.height, viewport.height);
    assert.ok(layout.targets.every((r) => r.width >= 44 && r.height >= 44 && r.right <= viewport.width && r.bottom <= viewport.height), "All battle actions fit and retain touch targets");
  }
  await a.setViewportSize(original);
  assert.deepEqual(await a.locator(".lan-battle-keys button").allTextContents(),
    ["Previous weapon", "↑ Power", "Next weapon", "← Angle", "↓ Power", "Angle →"]);
  assert.equal(await a.getByRole("button", { name: "Enter", exact: true }).count(), 0, "No duplicate Enter action in battle");
  const summary = a.locator(".lan-battle-more summary");
  await summary.focus(); await a.keyboard.press("Enter");
  assert.equal(await a.getByRole("button", { name: "Inventory", exact: true }).isVisible(), true);
  await a.keyboard.press("Tab");
  assert.equal(await a.getByRole("button", { name: "Inventory", exact: true }).evaluate((node) => node === document.activeElement), true);
  await host.evaluate(() => { window.onlineApp.gs.tanks[0].power = 0; });
  await until(async () => await a.getByRole("meter", { name: "Power" }).getAttribute("aria-valuenow") === "0", "zero power");
  assert.ok(await a.locator(".lan-battle-more").evaluate((node) => node.open), "State updates preserve More actions");
  assert.equal(await a.getByRole("button", { name: "Inventory", exact: true }).evaluate((node) => node === document.activeElement), true);
  await summary.click();
  await host.evaluate(() => { window.onlineApp.gs.tanks[0].power = 1000; });
  await until(async () => await a.getByRole("meter", { name: "Power" }).getAttribute("aria-valuenow") === "1000", "maximum power");
  assert.equal(await a.locator(".lan-power .lan-meter-fill").evaluate((node) => node.style.width), "100%");
  await a.setViewportSize({ width: 320, height: 320 });
  await a.locator(".lan-battle-more summary").click();
  await a.getByRole("button", { name: "Esc", exact: true }).scrollIntoViewIfNeeded();
  assert.ok(await a.evaluate(() => document.documentElement.scrollHeight > innerHeight), "Extreme sizes permit scrolling");
  assert.equal(await a.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await a.locator(".lan-battle-more summary").click();
  await a.setViewportSize(original);
  await a.evaluate(() => window.scrollTo(0, 0));
  await host.evaluate((saved) => saved.forEach((state, index) => Object.assign(window.onlineApp.gs.tanks[index], state)), saved);
  await until(async () => await a.getByRole("meter", { name: "Health" }).getAttribute("aria-valuenow") === String(saved[0].health), "battle values restored");
  console.log("PASS: live guest tank designs/colors/angles, health, power, responsive layout and keyboard disclosure");
}
