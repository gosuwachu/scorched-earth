import assert from "node:assert/strict";

/** Actual controller gestures must not send a firing command until committed. */
export async function checkFireGuard({ page, until, root }) {
  const fire = page.locator('button[data-fire-label="Fire"]');
  await page.evaluate(() => {
    window.fireInputs = [];
    const send = window.onlineSocket.send.bind(window.onlineSocket);
    window.onlineSocket.send = (data) => {
      const m = JSON.parse(data);
      if (m.type === "input" && m.input.kind === "key" && m.input.key === "Space" && m.input.down) window.fireInputs.push(m);
      send(data);
    };
  });
  const noShot = async () => assert.equal(await page.evaluate(() => window.fireInputs.length), 0);
  await fire.tap(); await noShot();
  await fire.click({ delay: 180 }); await noShot();
  const box = await fire.boundingBox();
  const start = async () => { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); };
  await start();
  await until(async () => await fire.getAttribute("data-fire-state") === "ready", "hold becomes ready");
  await noShot();
  await page.screenshot({ path: `${root}/test-browser/out/online-fire-ready.png` });
  await page.mouse.move(box.x, box.y - 15);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.up(); await noShot();
  for (const event of ["pointercancel", "lostpointercapture"]) {
    await start(); await fire.dispatchEvent(event); await page.waitForTimeout(700); await page.mouse.up(); await noShot();
  }
  await start(); await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.waitForTimeout(700); await page.mouse.up(); await noShot();
  const touch = await page.context().newCDPSession(page);
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...point, id: 1 }] });
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...point, id: 1 }, { x: 15, y: 15, id: 2 }] });
  await page.waitForTimeout(700);
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await touch.detach(); await noShot();
  await fire.focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Confirm shot" });
  await dialog.waitFor(); await noShot();
  assert.equal(await dialog.getByRole("button", { name: "Cancel", exact: true }).evaluate((b) => b === document.activeElement), true);
  await page.keyboard.press("Escape"); await dialog.waitFor({ state: "detached" }); await noShot();
  await page.screenshot({ path: `${root}/test-browser/out/online-fire-idle.png` });
  console.log("PASS: accidental touch, short hold, ready without release, slide-off, cancellations, multitouch and accessible confirmation");
}
