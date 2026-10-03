import assert from "node:assert/strict";
import { openHostMenu, settledDialogs } from "./dialogs.mjs";

const snapshot = (host) => host.evaluate(() => {
  const app = window.onlineApp, gs = app.gs;
  return {
    phase: gs.phase, round: gs.round_index, room: app.online.room.id,
    tanks: gs.tanks.map(({ alive, health, power, score, cash, win_counter }) => ({ alive, health, power, score, cash, win_counter })),
  };
});

/** Call with the host menu open outside battle. */
export async function checkMassKillDisabled(host) {
  const before = await snapshot(host);
  assert.equal(await host.getByRole("button", { name: "Mass Kill", exact: true }).isDisabled(), true);
  await host.keyboard.press("m");
  assert.equal(await host.getByRole("button", { name: "Yes", exact: true }).count(), 0);
  await host.evaluate(() => window.onlineApp._act("mass_kill"));
  assert.deepEqual(await snapshot(host), before, "Disabled Mass Kill cannot skip or award another round");
}

export async function massKillRound({ host, guests, click, until, root, capture = false }) {
  await openHostMenu(host);
  const before = await snapshot(host);
  assert.equal(await host.getByRole("button", { name: "Mass Kill", exact: true }).isEnabled(), true);
  for (const page of guests) {
    await until(async () => (await page.locator(".lan-status").textContent()).includes("Paused by host"), "Mass Kill menu pauses guests");
    assert.equal(await page.getByRole("button", { name: "Mass Kill", exact: true }).count(), 0);
  }
  if (capture) {
    const viewport = host.viewportSize();
    for (const size of [{ width: 390, height: 844 }, { width: 1200, height: 900 }]) {
      await host.setViewportSize(size);
      const box = await host.getByRole("dialog", { name: "System Menu", exact: true }).boundingBox();
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= size.width && box.y + box.height <= size.height);
      await host.screenshot({ path: `${root}/test-browser/out/online-mass-kill-${size.width}.png` });
    }
    await host.setViewportSize(viewport);
    await click(host, "Mass Kill");
    await host.getByRole("dialog", { name: "Mass kill everyone?", exact: true }).waitFor();
    await host.screenshot({ path: `${root}/test-browser/out/online-mass-kill-confirm.png` });
    await host.keyboard.press("Escape");
    await settledDialogs(host);
    assert.equal(await host.evaluate(() => document.activeElement.textContent), "Mass Kill");
    assert.deepEqual(await snapshot(host), before, "Cancel leaves the paused round unchanged");
    await host.keyboard.press("m");
    await settledDialogs(host);
  } else {
    await click(host, "Mass Kill");
  }
  await host.getByRole("dialog", { name: "Mass kill everyone?", exact: true }).waitFor();
  assert.deepEqual(await snapshot(host), before, "Confirmation does not execute early");
  await click(host, "Yes");
  await host.waitForFunction(() => window.onlineApp.onlineScreen === "rankings");
  const after = await snapshot(host);
  assert.equal(after.round, before.round + 1);
  assert.equal(after.room, before.room, "Mass Kill keeps the room open");
  const share = after.tanks[0].score - before.tanks[0].score;
  assert.ok(share > 0);
  after.tanks.forEach((tank, i) => assert.deepEqual(tank, {
    ...before.tanks[i], alive: false, health: 0, power: 0,
    score: before.tanks[i].score + share, cash: Math.max(0, before.tanks[i].cash + share),
  }, "Every tank gets the same award without win credit"));
  assert.deepEqual(await host.evaluate(() => window.onlineApp.stack.map((screen) => screen.uiKind)), ["battle", "rankings"], "Battle dialogs do not survive Mass Kill");
}
