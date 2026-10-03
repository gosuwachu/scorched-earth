import assert from "node:assert/strict";

/** Browser presentation/binding checks; these are not DOS comparison fixtures. */
export async function checkBattleControls({ host, a, b, root, until }) {
  const original = a.viewportSize();
  const saved = await host.evaluate(() => window.onlineApp.gs.tanks.slice(0, 2).map((t) => ({
    tank_icon: t.tank_icon, angle: t.angle, health: t.health, power: t.power,
    selected_weapon: t.selected_weapon, inventory: [...t.inventory],
  })));
  const canvas = (page) => page.locator(".lan-battle .lan-tank-preview canvas");
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
        assert.equal(await page.getByRole("meter", { name: "Angle", exact: true, includeHidden: true }).getAttribute("aria-valuenow"), String(angle));
      }
    }
  }
  assert.ok(await canvas(a).evaluate((node) => node === window.battleCanvas), "State updates preserve the canvas");
  for (const slot of [0, 7, 30, 31]) {
    await host.evaluate((slot) => { window.onlineApp.gs.tanks[0].selected_weapon = slot; }, slot);
    await checkWeaponSelector({ host, page: a, until });
  }
  await a.locator(".lan-battle-weapon-icon canvas").evaluate((node) => { window.weaponCanvas = node; });
  await host.evaluate(() => { window.onlineApp.gs.tanks[0].inventory[31] = 0; });
  await checkWeaponSelector({ host, page: a, until });
  assert.ok(await a.locator(".lan-battle-weapon-icon canvas").evaluate((node) => node === window.weaponCanvas), "Ammo updates preserve the weapon icon");
  await host.evaluate((saved) => Object.assign(window.onlineApp.gs.tanks[0], {
    selected_weapon: saved.selected_weapon, inventory: saved.inventory,
  }), saved[0]);
  await checkWeaponSelector({ host, page: a, until });
  await host.evaluate(() => Object.assign(window.onlineApp.gs.tanks[0], { tank_icon: 3, angle: 45, health: 65, power: 600 }));
  await until(async () => await a.getByRole("meter", { name: "Health" }).getAttribute("aria-valuenow") === "65", "damaged health reaches the controller");
  assert.equal(await a.getByRole("meter", { name: "Health" }).getAttribute("aria-valuetext"), "Health 65/100");
  assert.equal(await a.locator(".lan-battle .lan-health .lan-meter-fill").evaluate((node) => node.style.width), "65%");
  assert.equal(await a.getByRole("meter", { name: "Power" }).getAttribute("aria-valuenow"), "600");
  const preview = await canvas(a).boundingBox(), health = await a.locator(".lan-battle .lan-health").boundingBox();
  assert.ok(health.y + health.height <= preview.y, "Health stays above the turret");
  for (const viewport of [
    { width: 320, height: 568 }, { width: 390, height: 844 },
    { width: 844, height: 390 }, { width: 1440, height: 900 },
  ]) {
    await a.setViewportSize(viewport);
    const layout = await a.locator(".lan-battle").evaluate((battle) => {
      const root = document.querySelector(".lan-controller").getBoundingClientRect();
      const bounds = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
      return {
        width: root.width, height: root.height,
        title: bounds(".lan-controller > .ui-title"), status: bounds(".lan-status"), battle: battle.getBoundingClientRect().toJSON(),
        padding: parseFloat(getComputedStyle(document.querySelector(".lan-controller-body")).paddingTop),
        meters: [bounds(".lan-angle"), bounds(".lan-power")],
        arrows: ["ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"].map((code) => bounds(`button[data-key=${code}]`)),
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
    assert.ok(Math.abs(layout.status.top - layout.title.bottom - layout.padding) < 1, "Status stays at the top beneath the title");
    assert.ok(layout.battle.top - layout.status.bottom <= 24, "Battle follows the status without vertical centering");
    const [angle, power] = layout.meters;
    const [up, left, down, right] = layout.arrows;
    assert.ok(Math.abs(angle.top - power.top) < 1 && angle.right <= power.left, "Meters share one horizontal row");
    assert.ok(Math.max(angle.bottom, power.bottom) <= Math.min(...layout.arrows.map((r) => r.top)), "Both meters stay above every aiming button");
    assert.ok(up.bottom <= down.top && Math.abs(up.left + up.width / 2 - down.left - down.width / 2) < 1, "Power Up sits directly above Power Down");
    assert.ok(Math.abs(left.top - down.top) < 1 && Math.abs(right.top - down.top) < 1 && left.right <= down.left && down.right <= right.left,
      "Angle buttons flank Power Down");
  }
  await a.setViewportSize(original);
  for (const [group, labels] of [
    ["Weapon selection", ["Previous weapon", "Next weapon"]],
    ["Aiming controls", ["↑ Power", "← Angle", "↓ Power", "Angle →"]],
  ]) {
    assert.deepEqual(await a.getByRole("group", { name: group, exact: true }).locator("button[data-key]")
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))), labels);
  }
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

/** The selector uses the catalogue sprite and the host's live ammunition count. */
export async function checkWeaponSelector({ host, page, until, index = 0 }) {
  const expected = await host.evaluate(async (index) => {
    const { ITEMS } = await import("/src/weapons.ts");
    const { get_sprite, WEAPON_ICON_BASE, weapon_icon_palette } = await import("/src/sprites.ts");
    const tank = window.onlineApp.gs.tanks[index], slot = tank.selected_weapon;
    return {
      label: `${ITEMS[slot].name} (${tank.inventory[slot]})`,
      icon: get_sprite("A", slot, { color: WEAPON_ICON_BASE, pal: weapon_icon_palette(), scale: 2 }).canvas.toDataURL(),
    };
  }, index);
  await until(async () => await page.locator(".lan-battle-weapon").textContent() === expected.label, "weapon name and parenthesized ammo");
  assert.equal(await page.locator(".lan-battle-weapon-icon canvas").evaluate((node) => node.toDataURL()), expected.icon);
  assert.ok(await page.locator(".lan-battle-weapon-icon canvas").evaluate((node) => {
    const data = node.getContext("2d").getImageData(0, 0, node.width, node.height).data;
    return data.some((value, index) => index % 4 === 3 && value > 0) &&
      node.parentElement.getAttribute("aria-hidden") === "true" && getComputedStyle(node).imageRendering === "pixelated";
  }), "Weapon icon is painted, decorative, and pixelated");
}

export async function checkResults({ pages, screen, until }) {
  for (const page of pages) {
    await page.getByRole("heading", { name: screen, exact: true }).waitFor();
    await until(async () => (await page.locator(".lan-status").textContent()).includes(
      screen === "Round results" ? "Round complete" : "Match complete"), `${screen} reaches guest`);
    for (const selector of [".lan-keys", ".lan-battle", ".lan-stats"]) {
      assert.equal(await page.locator(selector).isVisible(), false, `${screen} hides ${selector}`);
    }
    assert.equal(await page.locator(".lan-controller button:visible").count(), 0, `${screen} has no tank actions`);
  }
}

/** Exercise real pointer and keyboard taps against the host, in either battle mode. */
export async function checkPreciseAim({ host, page, until }) {
  const values = () => host.evaluate(() => {
    const { angle, power } = window.onlineApp.gs.tanks[0];
    return { angle, power };
  });
  for (const [name, property, step] of [
    ["← Angle", "angle", 1], ["Angle →", "angle", -1],
    ["↑ Power", "power", 1], ["↓ Power", "power", -1],
  ]) {
    const before = await values();
    const button = page.getByRole("button", { name, exact: true });
    // Reconnect can show the frame before the host enables its controls.
    await button.click({ delay: 120 });
    await until(async () => (await values())[property] === before[property] + step, `${name}: precise pointer tap`);
    await page.waitForTimeout(400);
    assert.deepEqual(await values(), { ...before, [property]: before[property] + step }, `${name}: tap does not repeat`);
    await button.focus(); await page.keyboard.press("Enter");
    await until(async () => (await values())[property] === before[property] + 2 * step, `${name}: accessible tap`);
  }
}

export async function checkDisabledBattle(page) {
  for (const code of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
    const button = page.locator(`button[data-key=${code}]`);
    assert.ok(await button.isVisible(), `${code} stays visible while waiting`);
    assert.ok(await button.isDisabled(), `${code} is disabled while waiting`);
  }
  for (const name of ["Angle", "Power"]) assert.ok(await page.getByRole("meter", { name, exact: true }).isVisible());
}

export async function checkMovement({ host, a, b, root, until }) {
  const saved = await host.evaluate(() => {
    const t = window.onlineApp.gs.tanks[0];
    const saved = { x: t.x, y: t.y, mobile: t.mobile, inventory: [...t.inventory], fuel_remainder: t.fuel_remainder, angle: t.angle, power: t.power };
    t.mobile = true; t.inventory[46] = 0; t.fuel_remainder = 30;
    return saved;
  });
  const state = () => host.evaluate(() => {
    const gs = window.onlineApp.gs, t = gs.tanks[0];
    return { x: t.x, fuel: t.fuel, angle: t.angle, power: t.power, moving: !!gs.move_mode };
  });
  const before = await state();
  await until(async () => await a.getByRole("button", { name: "Move", exact: true }).isEnabled(), "movement available");
  await a.getByRole("button", { name: "Move", exact: true }).click();
  await until(async () => await a.getByRole("button", { name: "Finish moving", exact: true }).getAttribute("aria-pressed") === "true", "movement mode");
  const left = a.getByRole("button", { name: "Move left", exact: true });
  const box = await left.boundingBox();
  await a.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await a.mouse.down();
  await a.waitForTimeout(850); await a.mouse.up();
  let moved = await state();
  assert.equal(moved.x, before.x - 1, "Holding movement makes one engine step");
  assert.equal(moved.angle, before.angle, "Movement never changes angle");
  assert.ok(moved.fuel < before.fuel);
  await a.getByRole("button", { name: "Move right", exact: true }).focus(); await a.keyboard.press("Enter");
  await until(async () => (await state()).x === before.x, "accessible movement tap");
  await a.screenshot({ path: `${root}/test-browser/out/online-movement.png`, fullPage: true });
  await a.getByRole("button", { name: "Finish moving", exact: true }).click();
  await until(async () => await a.getByRole("button", { name: "← Angle", exact: true }).isVisible(), "aiming restored");
  const waiting = await b.getByRole("meter", { name: "Angle", exact: true }).getAttribute("aria-valuenow");
  await b.locator("button[data-key=ArrowLeft]").dispatchEvent("click", { detail: 0 });
  await b.locator(".lan-controller").click({ position: { x: 2, y: 2 } });
  await b.keyboard.press("ArrowLeft");
  await a.waitForTimeout(150);
  assert.equal(await b.getByRole("meter", { name: "Angle", exact: true }).getAttribute("aria-valuenow"), waiting);
  await host.evaluate(() => { const t = window.onlineApp.gs.tanks[0]; t.fuel_remainder = 1; });
  await a.getByRole("button", { name: "Move", exact: true }).click();
  await a.getByRole("button", { name: "Move left", exact: true }).click();
  await until(async () => await a.getByRole("button", { name: "Move left", exact: true }).isDisabled(), "exhausted movement disabled");
  assert.ok(await a.getByRole("button", { name: "Finish moving", exact: true }).isEnabled());
  await a.keyboard.press("Escape");
  await until(async () => await a.getByRole("button", { name: "Move", exact: true }).isDisabled(), "no fuel blocks entry");
  await host.evaluate(() => { const t = window.onlineApp.gs.tanks[0]; t.fuel_remainder = 10; t.mobile = false; });
  await until(async () => (await a.locator(".lan-movement-status").innerText()).includes("Immobile tank"), "immobile reason");
  assert.ok(await a.getByRole("button", { name: "Move", exact: true }).isDisabled());
  await host.evaluate((saved) => Object.assign(window.onlineApp.gs.tanks[0], saved), saved);
  await a.bringToFront();
  await until(async () => await a.getByRole("meter", { name: "Angle", exact: true }).getAttribute("aria-valuenow") === String(saved.angle), "movement state restored");
  console.log("PASS: explicit guest movement, fuel limits, held-input isolation and disabled waiting controls");
}
