import assert from "node:assert/strict";

/** Real setup and shop interactions around a controlled completed duel. */
export async function checkComeback(page, { click, settled, shot }) {
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.evaluate(() => {
    const app = window.onlineApp;
    app._act("to_menu");
    Object.assign(app.cfg, { ECONOMY_MODE: "CLASSIC", SCORING: "GREEDY", INITIAL_CASH: 10000,
      MAXPLAYERS: 2, MAXROUNDS: 2, TEAM_MODE: "NONE", PLAY_MODE: "SEQUENTIAL",
      SOUND: "OFF", HOSTILE_ENVIRONMENT: "OFF", OUTLAST_BONUS: "ON" });
  });
  await click("Start");
  const economy = page.getByRole("combobox", { name: "Economy", exact: true });
  assert.equal(await economy.inputValue(), "CLASSIC");
  await economy.selectOption("COMEBACK");
  assert.equal(await page.evaluate(() => window.onlineApp.cfg.SCORING), "STANDARD");
  assert.match(await page.locator(`#${await economy.getAttribute("aria-describedby")}`).textContent(), /100%.*\$5,000.*\$1,500/);
  await shot("comeback-setup");
  await click("Back"); await click("Economics");
  for (const expected of ["BASIC", "STANDARD", "BASIC"]) {
    await click("Increase Scoring Mode:");
    assert.equal(await page.evaluate(() => window.onlineApp.cfg.SCORING), expected);
  }
  await click("Decrease Scoring Mode:");
  assert.equal(await page.evaluate(() => window.onlineApp.cfg.SCORING), "STANDARD");
  await click("Done"); await click("Start");
  assert.equal(await economy.inputValue(), "COMEBACK");
  await click("Local"); await click("Continue");
  const name = page.getByRole("textbox", { name: "Name:" });
  await name.fill("Winner"); await click("Done");
  await name.fill("Recovering"); await click("Done");
  const income = page.getByRole("region", { name: "Round income", exact: true });
  assert.equal(await income.count(), 0, "Initial shop has no resupply");
  await click("Done"); await click("Done");
  await page.waitForFunction(() => window.onlineApp.gs.phase === "aim");
  await page.evaluate(async () => {
    const { award_hit, award_kill } = await import("/src/scoring.ts");
    const app = window.onlineApp, gs = app.gs;
    award_hit(gs, gs.tanks[0], gs.tanks[1], 100, false);
    award_kill(gs, gs.tanks[0], gs.tanks[1]);
    gs.tanks[1].alive = false;
    gs._end_round(); app._act("round_end");
  });
  await settled(); await click("Go");
  assert.match(await income.innerText(), /Resupply \+\$5,000/);
  assert.match(await income.innerText(), /Combat earnings \+\$8,500/);
  assert.match(await income.innerText(), /Recovery bonus \+\$0/);
  assert.equal(await page.evaluate(() => window.onlineApp.top.tank.cash), 23500);
  const breakdown = await income.innerText();
  await page.getByRole("button", { name: /^Missile, owned/ }).click(); await click("Update");
  assert.equal(await income.innerText(), breakdown, "Purchases change balance, not income history");
  await shot("comeback-winner-shop"); await click("Done");
  assert.match(await income.innerText(), /Recovery bonus \+\$500/);
  assert.match(await income.innerText(), /Total \+\$5,500/);
  assert.equal(await page.evaluate(() => window.onlineApp.top.tank.cash), 15500);
  await shot("comeback-recovery-shop");
  await page.setViewportSize({ width: 390, height: 844 });
  await income.scrollIntoViewIfNeeded(); await shot("comeback-mobile-shop");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await click("Done");
  await page.evaluate(() => window.onlineApp._act("to_menu"));
}
