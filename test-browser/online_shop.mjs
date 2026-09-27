import assert from "node:assert/strict";

export const purchaseButton = (page, name) => page.getByRole("button", { name: new RegExp(`^${name}, owned `) });

/** Compare the guest rows with the live host shop, including painted sprites. */
export async function checkShopRows(page, host) {
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
    if (width !== 390) await page.locator(".lan-controls").screenshot({ path: `${root}/test-browser/out/online-shop-${category}-${width}.png` });
  }
  await page.setViewportSize(original);
}
