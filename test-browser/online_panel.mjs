import assert from "node:assert/strict";
import { checkGuestReconnect } from "./online_shop.mjs";

/** Guest-only equipment ergonomics, using the authoritative host state. */
export async function checkGuestEquipment(page, host, root, until) {
  const guidance = page.getByRole("combobox", { name: "Guidance", exact: true });
  const shields = page.getByRole("combobox", { name: "Shields", exact: true });
  const discharge = page.getByRole("button", { name: /^Discharge battery/ });
  const overviewShield = page.locator(".lan-panel .lan-overview-shield");
  const tankState = () => host.evaluate(() => {
    const t = window.onlineApp.gs.tanks[0];
    return { health: t.health, batteries: t.inventory[39], shield: t.shield_item, shieldHP: t.shield_hp,
      shieldStock: t.inventory[41], guidance: t.selected_guidance };
  });
  const before = await tankState();
  const assertIcon = async (field, slot) => {
    const canvas = field.locator("..").locator(".lan-select-icon canvas");
    if (slot === null) {
      await until(async () => await canvas.count() === 0, "None clears the equipment icon");
      return;
    }
    await canvas.waitFor({ state: "visible" });
    const expected = await page.evaluate(async (slot) => {
      const { get_sprite, WEAPON_ICON_BASE, weapon_icon_palette } = await import("/src/sprites.ts");
      return get_sprite("A", slot, { color: WEAPON_ICON_BASE, pal: weapon_icon_palette(), scale: 2 }).canvas.toDataURL();
    }, slot);
    await until(async () => await canvas.evaluate((node) => node.toDataURL()) === expected, `selected icon matches catalogue slot ${slot}`);
  };
  assert.equal(await page.getByRole("heading", { name: "Power and energy", exact: true }).count(), 0);
  assert.equal(await page.getByLabel("Remaining Power:").count(), 0);
  await until(async () => await discharge.isDisabled(), "full health disables discharge");
  await assertIcon(guidance, null); await assertIcon(shields, 41);
  await guidance.selectOption({ label: "Heat Guidance" });
  await until(async () => (await tankState()).guidance === 33, "heat guidance selected");
  await assertIcon(guidance, 33);
  await guidance.focus(); await guidance.press("ArrowDown"); await guidance.press("Tab");
  await until(async () => (await tankState()).guidance === 37, "keyboard selects Lazy Boy");
  await assertIcon(guidance, 37);
  await shields.selectOption({ label: "None" });
  await assertIcon(shields, null);
  await shields.focus();
  await page.waitForTimeout(200);
  assert.equal(await shields.evaluate((node) => node === document.activeElement), true, "updates preserve native selector focus");
  assert.equal((await tankState()).shieldHP, before.shieldHP, "browsing shields does not alter the active shield");
  assert.equal(await overviewShield.innerText(), "Shield 100%");
  await checkGuestReconnect(page, until);
  await until(async () => await discharge.isVisible(), "equipment restored after reconnect");
  await assertIcon(guidance, 37); await assertIcon(shields, null);
  await host.evaluate(() => { window.onlineApp.gs.tanks[0].health = 80; });
  for (const [health, used] of [[90, 1], [100, 2]]) {
    await until(async () => await discharge.isEnabled(), "battery available");
    await discharge.click();
    await until(async () => (await tankState()).health === health, "single battery restores ten health");
    assert.equal((await tankState()).batteries, before.batteries - used);
    assert.equal(await page.getByLabel("Batteries to discharge:").count(), 0, "no quantity dialog");
    await until(async () => (await page.getByRole("meter", { name: "Health", exact: true }).filter({ visible: true }).getAttribute("aria-valuenow")) === String(health), "health overview updates");
    await assertIcon(shields, null);
  }
  await until(async () => await discharge.isDisabled(), "discharge stops at full health");
  await host.evaluate(() => {
    const t = window.onlineApp.gs.tanks[0]; t.health = 95; t.inventory[39] = 1;
  });
  await until(async () => await discharge.isEnabled(), "last battery available");
  await discharge.click();
  await until(async () => (await tankState()).health === 100 && (await tankState()).batteries === 0, "last battery caps health at 100");
  await host.evaluate(() => { window.onlineApp.gs.tanks[0].health = 80; });
  await until(async () => await discharge.isDisabled() && (await discharge.innerText()).includes("0 left"), "empty inventory disables discharge");
  await host.evaluate((stock) => {
    const t = window.onlineApp.gs.tanks[0]; t.health = 100; t.inventory[39] = stock;
  }, before.batteries - 2);
  await page.getByRole("button", { name: "Quit", exact: true }).click();
  await page.getByRole("region", { name: "Tank battle controls" }).waitFor();
  assert.equal((await tankState()).shieldHP, before.shieldHP, "Quit discards shield preview after discharge");
  await page.getByRole("button", { name: "Tank Control Panel", exact: true }).click();
  await shields.waitFor(); await assertIcon(shields, 41);
  await shields.selectOption({ label: "None" });
  await page.getByRole("button", { name: "Engage", exact: true }).click();
  await until(async () => (await tankState()).shieldHP === 0, "Engage removes shield");
  const battleShield = page.locator(".lan-battle .lan-overview-shield");
  await until(async () => !(await battleShield.isVisible()), "depleted shield readout hidden");
  await page.getByRole("button", { name: "Tank Control Panel", exact: true }).click();
  await shields.waitFor(); await assertIcon(shields, null);
  await shields.selectOption({ label: "Shield" });
  await page.getByRole("button", { name: "Engage", exact: true }).click();
  await until(async () => (await tankState()).shieldHP === 100, "Engage deploys selected shield");
  await until(async () => (await battleShield.innerText()) === "Shield 100%", "active shield in battle overview");
  await host.evaluate(() => { window.onlineApp.gs.tanks[0].shield_hp = 37; });
  await until(async () => (await battleShield.innerText()) === "Shield 37%", "damaged shield strength updates");
  await page.getByRole("button", { name: "Tank Control Panel", exact: true }).click();
  await shields.waitFor(); await assertIcon(shields, 41);
  await until(async () => (await overviewShield.innerText()) === "Shield 37%", "active shield in panel overview");
  await checkPanelLayout(page, root, "equipment");
  await shields.selectOption({ label: "None" }); await assertIcon(shields, null);
  assert.equal(await overviewShield.innerText(), "Shield 37%", "pending selection does not change active shield strength");
  await shields.selectOption({ label: "Shield" }); await assertIcon(shields, 41);
  await host.evaluate(({ stock, hp }) => {
    const t = window.onlineApp.gs.tanks[0]; t.inventory[41] = stock; t.shield_hp = hp;
  }, { stock: before.shieldStock, hp: before.shieldHP });
}

/** Real guest forms, with fixed actions and independently scrollable content. */
export async function checkPanelLayout(page, root, name) {
  const original = page.viewportSize();
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await page.locator(".lan-panel-footer button:enabled").first().waitFor({ state: "visible" });
    const layout = await page.locator(".lan-panel").evaluate((panel) => {
      const rect = (node) => node.getBoundingClientRect().toJSON();
      const fields = [...panel.querySelectorAll("button, input:not([type=checkbox]), select, .lan-toggle label")]
        .filter((node) => node.checkVisibility());
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        scroll: document.documentElement.scrollHeight > innerHeight + 1,
        footer: rect(panel.querySelector(".lan-panel-footer")),
        actions: [...panel.querySelectorAll(".lan-panel-footer button")].filter((node) => node.checkVisibility()).map(rect),
        fields: fields.map(rect),
      };
    });
    assert.equal(layout.overflow, false, `${name}: no horizontal overflow at ${width}`);
    assert.equal(layout.scroll, false, `${name}: frame fits ${width}x${height}`);
    assert.ok(layout.footer.y >= 0 && layout.footer.bottom <= height, `${name}: footer remains visible`);
    assert.ok(layout.actions.length > 0, `${name}: active footer actions are visible`);
    assert.ok(layout.actions.every((r) => Math.abs(r.top - layout.actions[0].top) < 1 &&
      Math.abs(r.bottom - layout.actions[0].bottom) < 1), `${name}: footer buttons align at ${width}px`);
    assert.ok(layout.fields.every((r) => r.width >= 44 && r.height >= 44), `${name}: accessible touch targets`);
    if (name === "targeting") {
      const target = await page.locator(".lan-target-position").evaluate((node) => {
        const rect = (selector) => node.querySelector(selector).getBoundingClientRect().toJSON();
        return {
          readouts: [...node.querySelectorAll("output")].map((output) => output.getBoundingClientRect().toJSON()),
          up: rect("[data-key=ArrowUp]"), down: rect("[data-key=ArrowDown]"),
          left: rect("[data-key=ArrowLeft]"), right: rect("[data-key=ArrowRight]"),
        };
      });
      assert.equal(target.readouts.length, 2);
      assert.ok(target.readouts.every((r) => r.bottom <= target.up.top && r.right <= width), "coordinates sit above the arrows");
      assert.ok(target.up.bottom <= target.down.top && Math.abs(target.up.x - target.down.x) < 1, "up sits above down");
      assert.ok(target.left.right <= target.down.left && target.down.right <= target.right.left &&
        Math.abs(target.left.top - target.down.top) < 1 && Math.abs(target.right.top - target.down.top) < 1, "left/down/right share the lower row");
    }
    await page.screenshot({ path: `${root}/test-browser/out/online-${name}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize(original);
}
