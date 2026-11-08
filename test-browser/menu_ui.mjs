import assert from "node:assert/strict";

export const menuLabels = ["Start", "Quick Game", "Sound", "Hardware", "Economics", "Landscape", "Physics", "Play Options", "Weapons", "Save Changes", "About"];

export async function checkMenuLayout(page) {
  const menu = page.getByRole("region", { name: "Main Menu", exact: true });
  const buttons = menu.getByRole("button");
  assert.deepEqual(await buttons.allTextContents(), menuLabels);
  const panel = await menu.boundingBox();
  const boxes = [];
  for (const button of await buttons.all()) boxes.push(await button.boundingBox());
  for (const box of boxes) {
    assert.ok(box.x >= panel.x && box.x + box.width <= panel.x + panel.width + 1, "Menu actions fit their panel");
    assert.ok(box.height >= 38, "Menu actions have usable hit targets");
  }
  assert.ok(boxes[0].height > boxes[2].height, "Start is taller than the settings");
  for (let i = 2; i < 9; i++) {
    assert.ok(Math.abs(boxes[i].width - boxes[2].width) < 1, "Settings have equal widths");
    assert.ok(Math.abs(boxes[i].x - boxes[2 + (i - 2) % 2].x) < 1, "Settings form two aligned columns");
  }
  assert.ok(await buttons.evaluateAll((nodes) => nodes.every((node) => {
    const style = getComputedStyle(node);
    return style.textAlign === "center" && parseFloat(style.borderTopWidth) > 0;
  })), "Every action is a centered, outlined button");
  const background = await buttons.first().evaluate((node) => getComputedStyle(node).backgroundImage);
  assert.match(background, /linear-gradient/, "Start has the modern accent treatment");
  // Focusing every action also checks that short screens can scroll to the last one.
  await buttons.first().focus();
  for (let i = 0; i < menuLabels.length; i++) {
    const button = buttons.nth(i);
    assert.ok(await button.evaluate((node) => node === document.activeElement), "Tab order matches the visual order");
    assert.ok(await button.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      // Scrolling uses integer CSS pixels; glyph/layout bounds can be fractional.
      return rect.top >= -1 && rect.bottom <= innerHeight + 1 && rect.left >= -1 && rect.right <= innerWidth + 1;
    }), "Focused menu actions stay inside the viewport");
    assert.ok(await button.evaluate((node) => {
      const r = node.getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest("button") === node;
    }), `${menuLabels[i]} is not covered by the title artwork or another element`);
    await page.keyboard.press("Tab");
  }
  assert.ok(await buttons.first().evaluate((node) => node === document.activeElement), "Tab wraps to Start");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "No horizontal page overflow");
}

export async function checkPlayerGrid(page) {
  const players = page.getByRole("group", { name: "Players", exact: true });
  const radios = players.getByRole("radio");
  assert.deepEqual(await radios.evaluateAll((nodes) => nodes.map((node) => node.value)), ["2", "3", "4", "5", "6", "7", "8", "9", "10"]);
  assert.equal(await players.locator("input:checked").count(), 1);
  const cells = await players.locator("label").evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right };
  }));
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    assert.ok(cell.height >= 22 && cell.height < 44, "Host player cells use compact game-menu sizing");
    assert.ok(Math.abs(cell.width - cells[0].width) < 1);
    assert.ok(Math.abs(cell.x - cells[i % 3].x) < 1, "Three aligned columns");
    assert.ok(Math.abs(cell.y - cells[Math.floor(i / 3) * 3].y) < 1, "Counts increase across rows");
    assert.ok(cell.x >= 0 && cell.right <= page.viewportSize().width, "Grid fits the viewport");
  }
}
