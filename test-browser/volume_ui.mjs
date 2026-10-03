import assert from "node:assert/strict";
import { settledDialogs } from "./dialogs.mjs";

export async function checkVolume(page, shot) {
  const settled = () => settledDialogs(page);
  const open = async () => {
    await page.getByRole("button", { name: "Sound", exact: true }).click();
    await settled();
  };
  const slider = page.getByRole("slider", { name: "Volume", exact: true });
  const sound = page.getByRole("checkbox", { name: "Sound:", exact: true });
  const volume = () => page.evaluate(async () => (await import("/src/sound.ts")).sfx.volume);
  const check = async (percent) => {
    assert.equal(await slider.inputValue(), String(percent));
    assert.equal(await slider.getAttribute("aria-valuetext"), `${percent}%`);
    assert.equal(await slider.locator("..").locator("output").textContent(), `${percent}%`);
    assert.equal(await volume(), percent / 100);
  };
  await open();
  await check(100);
  await slider.focus();
  await page.keyboard.press("Home"); await check(0);
  await page.keyboard.press("ArrowRight"); await check(1);
  await page.keyboard.press("End"); await check(100);
  const box = await slider.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const midpoint = Number(await slider.inputValue());
  assert.ok(midpoint >= 45 && midpoint <= 55, "Pointer sets a middle volume");
  await check(midpoint);
  await sound.uncheck();
  await slider.focus(); await page.keyboard.press("ArrowLeft");
  const saved = midpoint - 1;
  await check(saved);
  assert.equal(await sound.isChecked(), false, "Adjusting volume does not enable Sound");
  await sound.check(); await check(saved);
  await shot("volume");
  await page.keyboard.press("Escape"); await settled();
  await open(); await check(saved);
  await page.getByRole("button", { name: "Done", exact: true }).click(); await settled();
  await page.reload(); await page.waitForFunction(() => !!window.onlineApp);
  assert.equal(await volume(), saved / 100, "Preference restores during boot");
  await open(); await check(saved);
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 360, height: 640 });
  await slider.focus();
  assert.ok(await slider.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
  }), "Slider fits a narrow viewport");
  await shot("volume-mobile");
  await page.setViewportSize(viewport);
  // Leave the remaining UI scenarios with the original full-volume default.
  await page.keyboard.press("End"); await check(100);
  await page.getByRole("button", { name: "Done", exact: true }).click(); await settled();
}
