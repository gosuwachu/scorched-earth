import assert from "node:assert/strict";

export const menuLabels = ["Start", "Sound", "Hardware", "Economics", "Landscape", "Physics", "Play Options", "Weapons", "Save Changes", "About"];

export async function checkMenuLayout(page) {
  const menu = page.getByRole("region", { name: "Main Menu", exact: true });
  const buttons = menu.getByRole("button");
  assert.deepEqual(await buttons.allTextContents(), menuLabels);
  const panel = await menu.boundingBox();
  const boxes = [];
  for (const button of await buttons.all()) boxes.push(await button.boundingBox());
  for (const box of boxes) {
    assert.ok(Math.abs(box.width - boxes[0].width) < 1, "Menu buttons have equal widths");
    assert.ok(Math.abs(box.x + box.width / 2 - (panel.x + panel.width / 2)) < 2, "Buttons are centered in the menu");
  }
  assert.ok(boxes[0].height > boxes[1].height, "Start is taller than the settings");
  const gap = (i) => boxes[i].y - boxes[i - 1].y - boxes[i - 1].height;
  for (const i of [1, 8, 9]) assert.ok(gap(i) > gap(2) * 2, "Groups have larger gaps than settings");
  assert.ok(await buttons.evaluateAll((nodes) => nodes.every((node) => {
    const style = getComputedStyle(node);
    return style.textAlign === "center" && parseFloat(style.borderTopWidth) > 0;
  })), "Every action is a centered, beveled button");
  const color = await buttons.first().evaluate((node) => getComputedStyle(node).backgroundColor);
  const [r, g, b] = color.match(/\d+/g).map(Number);
  assert.ok(g > r && g > b, "Start is green");
  // Focusing every action also checks that short screens can scroll to the last one.
  await buttons.first().focus();
  for (let i = 0; i < menuLabels.length; i++) {
    const button = buttons.nth(i);
    assert.ok(await button.evaluate((node) => node === document.activeElement), "Tab order matches the visual order");
    assert.ok(await button.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth;
    }), "Focused menu actions stay inside the viewport");
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
