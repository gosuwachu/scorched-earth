import assert from "node:assert/strict";

export const settledDialogs = (page) => page.waitForFunction(() =>
  !window.onlineApp?.transitioning && !document.getAnimations().some((a) => a.playState === "running" || a.playState === "paused"));

export async function checkDialogLayout(page, name) {
  await settledDialogs(page);
  const layout = await page.getByRole("dialog", { name, exact: true }).evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const footer = node.querySelector(".ui-dialog-footer").getBoundingClientRect();
    const body = node.querySelector(".ui-dialog-body, .ui-panel-body");
    return {
      width: rect.width, expected: Math.min(600, innerWidth - 16),
      contained: rect.left >= 7 && rect.right <= innerWidth - 7 && rect.top >= 0 && rect.bottom <= innerHeight,
      footerVisible: footer.top >= rect.top && footer.bottom <= rect.bottom,
      overflow: node.scrollWidth > node.clientWidth || body.scrollWidth > body.clientWidth,
    };
  });
  assert.ok(Math.abs(layout.width - layout.expected) < 1, `${name} shares the settings width`);
  assert.ok(layout.contained && layout.footerVisible, `${name} and its actions fit the viewport`);
  assert.equal(layout.overflow, false, `${name} has no horizontal overflow`);
}

async function clickTransition(button) {
  return button.evaluate((node) => {
    node.click();
    const dialog = [...document.querySelectorAll("dialog[open]")].at(-1);
    const animation = dialog?.getAnimations()[0];
    if (!animation) return null;
    const { duration, easing } = animation.effect.getTiming();
    return { duration, easing, frames: animation.effect.getKeyframes().map(({ transform, opacity }) => ({ transform, opacity })) };
  });
}

export async function checkSetupDialogs(page, shot) {
  const viewport = page.viewportSize();
  const button = (name) => page.getByRole("button", { name, exact: true });
  for (const size of [viewport, { width: 390, height: 844 }, { width: 800, height: 480 }]) {
    await page.setViewportSize(size);
    const opening = await clickTransition(button("Sound"));
    assert.ok(opening && Math.abs(opening.duration - 1000 / 3) < .01);
    assert.equal(opening.easing, "linear");
    await checkDialogLayout(page, "Sound");
    const closing = await clickTransition(button("Done"));
    assert.deepEqual(closing.frames, [...opening.frames].reverse());
    await settledDialogs(page);
    assert.deepEqual(await clickTransition(button("Start")), opening, "New game uses the settings opening transition");
    await checkDialogLayout(page, "New game");
    assert.deepEqual(await clickTransition(button("Local")), closing, "Navigation animates the outgoing dialog");
    assert.equal(await page.locator("dialog[open]").count(), 1, "Next dialog waits for the outgoing dialog");
    await page.getByRole("dialog", { name: "Local game", exact: true }).waitFor();
    await checkDialogLayout(page, "Local game");
    await shot(`shared-dialog-${size.width}x${size.height}`);
    assert.deepEqual(await clickTransition(button("Back")), closing, "Local game shares the closing transition");
    await settledDialogs(page);
    assert.equal(await page.evaluate(() => document.activeElement.textContent), "Start");
  }
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await clickTransition(button("Start")), null, "Reduced motion opens immediately");
  assert.equal(await clickTransition(button("Local")), null, "Reduced motion navigates immediately");
  assert.equal(await clickTransition(button("Back")), null, "Reduced motion closes immediately");
  assert.equal(await page.locator("dialog[open]").count(), 0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  // Rapid repeated clicks during an opening transition must not navigate twice.
  await clickTransition(button("Start"));
  await button("Local").evaluate((node) => { node.click(); node.click(); });
  await settledDialogs(page);
  assert.ok(await page.getByRole("dialog", { name: "New game", exact: true }).isVisible());
  await button("Local").click();
  await page.getByRole("dialog", { name: "Local game", exact: true }).waitFor();
  await settledDialogs(page);
  await button("Back").evaluate((node) => { node.click(); node.click(); });
  await page.getByRole("dialog", { name: "Local game", exact: true }).waitFor({ state: "detached" });
  await settledDialogs(page);
  assert.equal(await page.locator("dialog[open]").count(), 0);
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "Start");
}

export async function checkNoOnlineBar(page) {
  assert.equal(await page.locator(".lan-bar").count(), 0);
  assert.ok(await page.evaluate(() => !document.body.classList.contains("lan-host") && !document.body.style.getPropertyValue("--lan-bar-height")), "No space reserved for an online toolbar");
}

export async function openHostMenu(page) {
  await settledDialogs(page);
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "System Menu", exact: true }).waitFor();
  await settledDialogs(page);
}

export async function closeHostMenu(page) {
  await settledDialogs(page);
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "System Menu", exact: true }).waitFor({ state: "detached" });
  await settledDialogs(page);
}
