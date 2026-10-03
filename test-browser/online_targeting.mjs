import assert from "node:assert/strict";

/** Real guest arrows and host-owned coordinates; no simulation baseline. */
export async function checkTargetArrows({ page, host, waiting, until }) {
  const point = () => host.evaluate(() => window.onlineApp.gs.pendingTarget.point);
  const arrow = (direction) => page.getByRole("button", { name: `Move target ${direction}`, exact: true });
  const matches = async (expected, label = "target point reaches host") => {
    await until(async () => JSON.stringify(await point()) === JSON.stringify(expected), `${label}: ${expected}`);
    for (const [axis, value] of [["X", expected[0]], ["Y", expected[1]]]) {
      await until(async () => await page.getByLabel(`Target ${axis}`, { exact: true }).innerText() === String(value), "target readout reaches guest");
    }
  };
  const saved = await host.evaluate(() => {
    const gs = window.onlineApp.gs, t = gs.tanks[0];
    return { center: [Math.floor(gs.w / 2), Math.floor(gs.h / 2)], angle: t.angle, power: t.power, fuel: t.fuel };
  });
  assert.equal(await point(), null);
  assert.equal(await page.locator(".lan-panel input").count(), 0, "coordinates are not editable");
  assert.equal(await page.locator(".lan-target-readouts output").count(), 2);
  assert.equal(await waiting.getByRole("button", { name: /^Move target/ }).count(), 0);
  const [x, y] = saved.center;
  await arrow("right").tap(); await matches([x + 1, y]);
  await arrow("left").click(); await matches([x, y]);
  await arrow("up").focus(); await page.keyboard.press("Enter"); await matches([x, y - 1]);
  assert.equal(await arrow("up").evaluate((node) => node === document.activeElement), true, "updates retain focus");
  await page.keyboard.press("Tab");
  assert.equal(await arrow("left").evaluate((node) => node === document.activeElement), true, "Tab navigates the pad");
  await page.keyboard.press("ArrowDown"); await matches([x, y]);

  // A real pointer hold repeats on host frames, keeping the mounted button/capture.
  const right = arrow("right");
  await right.scrollIntoViewIfNeeded();
  const bounds = await right.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await until(async () => (await point())[0] > x + 5, "held pointer accelerates target movement");
  await page.mouse.up();
  await page.waitForTimeout(150);
  const released = await point();
  await page.waitForTimeout(550); await matches(released);

  const touch = await page.context().newCDPSession(page);
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }] });
  await until(async () => (await point())[0] > released[0] + 5, "held touch accelerates target movement");
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await touch.detach();
  await page.waitForTimeout(150);
  const touchReleased = await point();
  await page.waitForTimeout(550); await matches(touchReleased);

  const stopChecks = [
    ["pointercancel", () => right.dispatchEvent("pointercancel", { pointerId: 1 })],
    ["lostpointercapture", async () => {
      await right.evaluate((node) => node.releasePointerCapture(1));
      // Chromium processes a requested capture change with the next pointer event.
      await page.mouse.move(bounds.x + bounds.width / 2 + 1, bounds.y + bounds.height / 2);
    }],
    ["blur", () => page.evaluate(() => window.dispatchEvent(new Event("blur")))],
  ];
  for (const [name, stop] of stopChecks) {
    const before = await point();
    await page.mouse.down();
    await until(async () => (await point())[0] === before[0] + 1, `${name}: initial tap`);
    await stop();
    await page.waitForTimeout(600);
    await matches([before[0] + 1, before[1]], `${name}: hold stopped`);
    await page.mouse.up();
  }

  // Physical arrow keys hold too; selecting a tank must stop that hold.
  await page.keyboard.down("ArrowUp");
  await until(async () => (await point())[1] < y - 5, "held keyboard moves target upward");
  await page.getByRole("button", { name: /^\d+: Bob$/ }).click();
  const bob = await host.evaluate(() => {
    const t = window.onlineApp.gs.tanks[1]; return [t.x, t.y];
  });
  await matches(bob); await page.waitForTimeout(550); await matches(bob);
  await page.keyboard.up("ArrowUp");
  assert.equal(await host.evaluate(() => window.onlineApp.gs.pendingTarget.target.name), "Bob");
  await arrow("left").tap(); await matches([bob[0] - 1, bob[1]]);
  assert.equal(await host.evaluate(() => window.onlineApp.gs.pendingTarget.target), null, "nudging creates a point target");

  await page.keyboard.down("ArrowUp");
  await until(async () => (await point())[1] < bob[1], "target moving before disconnect");
  await page.context().setOffline(true);
  await page.evaluate(() => window.onlineSocket.close());
  await until(async () => (await page.locator(".lan-status").innerText()).includes("Connection lost"), "target controller disconnected");
  await page.waitForTimeout(600);
  const disconnected = await point();
  await page.context().setOffline(false);
  await until(async () => await arrow("up").isVisible(), "target controller reconnects");
  await page.keyboard.up("ArrowUp");
  await page.waitForTimeout(550); await matches(disconnected);
  const aim = await host.evaluate(() => {
    const t = window.onlineApp.gs.tanks[0]; return { angle: t.angle, power: t.power, fuel: t.fuel };
  });
  assert.deepEqual(aim, { angle: saved.angle, power: saved.power, fuel: saved.fuel });
  console.log("PASS: target readouts, one-pixel touch/mouse/keyboard taps, held arrows, release/cancel/blur, tank selection and reconnect");
  return point();
}
