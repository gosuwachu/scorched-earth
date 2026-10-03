import assert from "node:assert/strict";

export const purchaseButton = (page, name) => page.getByRole("button", { name: new RegExp(`^${name}, owned `) });

/** Host and guest share the current shopper's real controls and state. */
export async function checkHostShopping({ host, guest, click, enabled, until }) {
  for (const name of ["^", "v"]) assert.equal(await host.getByRole("button", { name, exact: true }).count(), 0);
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
  await until(async () => (await guest.locator(".lan-shop-cash").innerText()).includes(`Cash $${before.cash - 2 * before.price}`), "host purchases reach guest");
  await click(host, "Miscellaneous");
  await until(async () => await guest.getByRole("button", { name: "Miscellaneous", exact: true }).getAttribute("aria-pressed") === "true", "host category reaches guest");
  await checkShopRows(guest, host);
  await click(host, "Weapons");
  await checkShopRows(guest, host);

  // Disconnect the actual host transport, then exercise the disabled keyboard path.
  const cash = await host.evaluate(() => window.onlineApp.top.tank.cash);
  await host.context().setOffline(true);
  await host.evaluate(() => window.onlineApp.online.connection.socket.close());
  await until(async () => (await guest.locator(".lan-status").innerText()).includes("Host unavailable"), "host loss reaches guest");
  await checkNoGuestActions(guest);
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
  for (const name of ["^", "v", "Update"]) assert.equal(await page.getByRole("button", { name, exact: true }).count(), 0);
  assert.match(await page.locator(".lan-shop-cash").innerText(), /^Cash \$\d+$/, "Purchasing shows cash without battle readouts");
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
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1440, 900]]) {
    await page.setViewportSize({ width, height });
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
    const footer = await page.locator(".lan-shop-actions").boundingBox();
    assert.ok(footer.y >= 0 && footer.y + footer.height <= height, `${category}: footer stays visible at ${width}x${height}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 1), false);
    await page.screenshot({ path: `${root}/test-browser/out/online-shop-${category}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize(original);
}

export async function checkNoGuestActions(page) {
  assert.equal(await page.locator(".lan-controller :is(button, input, select, summary):visible").count(), 0,
    "Unavailable guest screens expose no action controls");
}

export async function checkShopEdges(page, host, until) {
  const saved = await host.evaluate(() => {
    const shop = window.onlineApp.top;
    const saved = { cash: shop.tank.cash, inventory: [...shop.tank.inventory] };
    shop.tank.cash = shop.econ.price[1];
    shop._refresh_items();
    return saved;
  });
  await checkShopRows(page, host);
  const missile = purchaseButton(page, "Missile");
  await missile.focus();
  await missile.press("Enter");
  await until(async () => await page.locator(".lan-shop-empty").isVisible(), "last affordable bundle leaves an empty shop");
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector(".lan-shop-list")), true,
    "Focus returns to the list when the purchased row disappears");
  assert.ok(await page.getByRole("button", { name: "Done", exact: true }).isEnabled());
  await host.evaluate((saved) => {
    const shop = window.onlineApp.top;
    shop.tank.cash = saved.cash;
    shop.tank.inventory.splice(0, shop.tank.inventory.length, ...saved.inventory);
    shop._refresh_items();
  }, saved);
  await checkShopRows(page, host);
  const list = page.locator(".lan-shop-list");
  await list.focus();
  await page.keyboard.press("PageDown");
  await until(async () => await list.evaluate((node) => node.scrollTop) > 0, "native keyboard list scrolling");
  await page.getByRole("button", { name: "Miscellaneous", exact: true }).click();
  await purchaseButton(page, "Battery").waitFor();
  assert.equal(await list.evaluate((node) => node.scrollTop), 0, "category changes reset list scroll");
  await page.getByRole("button", { name: "Weapons", exact: true }).click();
  await checkShopRows(page, host);
}

/** Real transport loss across forms and battle; stale controls stay hidden until fresh state arrives. */
export async function checkGuestReconnect(page, until) {
  await page.context().setOffline(true);
  await page.evaluate(() => window.onlineSocket.close());
  await until(async () => (await page.locator(".lan-status").innerText()).includes("Connection lost"), "guest disconnected");
  await checkNoGuestActions(page);
  await page.context().setOffline(false);
  await until(async () => !(await page.locator(".lan-status").innerText()).match(/Connection lost|Host unavailable|Waiting for the host…/), "guest reconnected");
}
