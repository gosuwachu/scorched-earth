import assert from "node:assert/strict";

export const purchaseButton = (page, name) => page.getByRole("button", { name: new RegExp(`^${name}, owned `) });

/** Host and guest share the current shopper's real controls and state. */
export async function checkHostShopping({ host, guest, click, enabled, until }) {
  for (const name of ["Update", "Inventory", "Done", "Weapons", "Miscellaneous"]) {
    assert.ok(await enabled(host, name), `Host can use ${name} during purchasing`);
  }
  await host.getByLabel("Available equipment", { exact: true }).focus();
  const selection = await host.evaluate(() => window.onlineApp.top.sel_row);
  await host.keyboard.press("ArrowDown");
  assert.equal(await host.evaluate(() => window.onlineApp.top.sel_row), selection + 1);
  await host.keyboard.press("ArrowUp");
  assert.equal(await host.evaluate(() => window.onlineApp.top.sel_row), selection);
  await host.keyboard.press("PageDown");
  assert.ok(await host.evaluate(() => {
    const shop = window.onlineApp.top;
    return shop.scroll === Math.min(shop.rows_visible, shop._max_scroll());
  }));
  await host.keyboard.press("PageUp");

  await purchaseButton(host, "Missile").click();
  const before = await host.evaluate(() => {
    const shop = window.onlineApp.top;
    return { cash: shop.tank.cash, owned: shop.tank.inventory[1], price: shop.econ.price[1] };
  });
  for (const keyboard of [false, true]) {
    if (keyboard) await host.keyboard.press("u"); else await click(host, "Update");
    const count = keyboard ? 2 : 1;
    assert.deepEqual(await host.evaluate(() => {
      const tank = window.onlineApp.top.tank;
      return { cash: tank.cash, owned: tank.inventory[1] };
    }), { cash: before.cash - count * before.price, owned: before.owned + count * 5 });
    await checkShopRows(guest, host);
  }
  await until(async () => (await guest.locator(".lan-stats").innerText()).includes(`Cash $${before.cash - 2 * before.price}`), "host purchases reach guest");
  await click(host, "Miscellaneous");
  await until(async () => await guest.getByLabel("Category", { exact: true }).inputValue() === "1", "host category reaches guest");
  await checkShopRows(guest, host);
  await click(host, "Weapons");
  await checkShopRows(guest, host);

  // Disconnect the actual host transport, then exercise the disabled keyboard path.
  const cash = await host.evaluate(() => window.onlineApp.top.tank.cash);
  await host.context().setOffline(true);
  await host.evaluate(() => window.onlineApp.online.connection.socket.close());
  await until(async () => !await enabled(host, "Update"), "host purchasing pauses on connection loss");
  assert.equal(await enabled(host, "Done"), false);
  assert.equal(await host.locator(".ui-shop-row:enabled").count(), 0);
  await host.keyboard.press("u");
  assert.equal(await host.evaluate(() => window.onlineApp.top.tank.cash), cash);
  await host.context().setOffline(false);
  await until(() => enabled(host, "Update"), "host purchasing resumes after reconnect");
  await until(() => enabled(guest, "Done"), "guest purchasing resumes after host reconnect");
}

/** Compare the guest rows with the live host shop, including painted sprites. */
export async function checkShopRows(page, host) {
  assert.equal(await page.locator(".lan-keys").isVisible(), false, "Purchasing hides the entire battle keypad");
  assert.equal(await page.locator(".lan-battle").isVisible(), false);
  assert.match(await page.locator(".lan-stats").innerText(), /^Cash \$\d+$/, "Purchasing shows cash without battle readouts");
  const expected = await host.evaluate(async () => {
    const { ITEMS } = await import("/src/weapons.ts");
    const shop = window.onlineApp.top;
    return shop.items.map((slot) => ({
      label: `${ITEMS[slot].name}, owned ${shop.tank.inventory[slot]}, $${shop.econ.price[slot]} per ${ITEMS[slot].bundle}`,
      selected: slot === shop._selected_slot(), disabled: !shop._affordable(slot),
    }));
  });
  await page.waitForFunction((labels) => {
    const rows = [...document.querySelectorAll(".lan-shop-row")];
    return rows.length === labels.length && rows.every((row, i) => row.getAttribute("aria-label") === labels[i]);
  }, expected.map((row) => row.label));
  const actual = await page.locator(".lan-shop-row").evaluateAll((rows) => rows.map((row) => {
    const canvas = row.querySelector("canvas");
    const pixels = canvas?.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    return {
      label: row.getAttribute("aria-label"), selected: row.getAttribute("aria-pressed") === "true", disabled: row.disabled,
      painted: !!pixels?.some((value, i) => i % 4 === 3 && value > 0),
      decorative: canvas?.parentElement.getAttribute("aria-hidden") === "true",
      pixelated: canvas && getComputedStyle(canvas).imageRendering === "pixelated",
    };
  }));
  assert.deepEqual(actual.map(({ label, selected, disabled }) => ({ label, selected, disabled })), expected);
  assert.ok(actual.length > 0 && actual.every((row) => row.painted && row.decorative && row.pixelated), "Every purchase has a painted, decorative pixel sprite");
}

export async function checkShopLayout(page, root, category) {
  const original = page.viewportSize();
  for (const width of [320, 390, 960]) {
    await page.setViewportSize({ width, height: 844 });
    const layout = await page.locator(".lan-shop-row").evaluateAll((rows) => ({
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      rows: rows.map((row) => {
        const bounds = row.getBoundingClientRect();
        const name = row.querySelector(".lan-shop-name");
        return {
          height: bounds.height, fits: row.scrollWidth <= row.clientWidth,
          nameFits: name.scrollWidth <= name.clientWidth,
          cellsFit: [...row.children].every((cell) => {
            const r = cell.getBoundingClientRect();
            return r.left >= bounds.left && r.right <= bounds.right && r.top >= bounds.top && r.bottom <= bounds.bottom;
          }),
        };
      }),
    }));
    assert.equal(layout.overflow, false, `${category}: no horizontal page overflow at ${width}px`);
    assert.ok(layout.rows.every((row) => row.height >= 44 && row.fits && row.nameFits && row.cellsFit), `${category}: readable rows and touch targets at ${width}px`);
    if (width !== 390) await page.screenshot({ path: `${root}/test-browser/out/online-shop-${category}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize(original);
}
