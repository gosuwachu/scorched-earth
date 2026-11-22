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
  assert.match(await page.locator(`#${await economy.getAttribute("aria-describedby")}`).textContent(), /\$7,500.*\$1,000.*3.*players.*\$1,500/);
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
  await settled();
  const results = page.locator(".ui-results");
  const goFocused = () => results.getByRole("button", { name: "Go", exact: true }).evaluate(node => node === document.activeElement);
  assert.equal(await goFocused(), true, "Round results focus Go rather than income details");
  assert.deepEqual(await results.locator("th").allTextContents(), ["Rank", "Player", "Score", "Wins", "Round income"]);
  const rows = results.locator("tbody tr");
  assert.deepEqual(await rows.nth(0).locator("td").allTextContents(), ["#1", "Winner", "8,500", "1", "+$27,000"]);
  assert.deepEqual(await rows.nth(1).locator("td").allTextContents(), ["#2", "Recoveri", "0", "0", "+$8,000"]);
  const beforeResults = await page.evaluate(() => window.onlineApp.gs.tanks.map(t => t.cash));
  await results.getByText("Round income details", { exact: true }).click();
  assert.match(await results.locator("details").innerText(), /Resupply \+\$7,500/);
  assert.match(await results.locator("details").innerText(), /Recovery bonus \+\$500/);
  await results.getByText("Round income details", { exact: true }).click();
  await shot("comeback-results");
  await page.setViewportSize({ width: 390, height: 844 });
  await shot("comeback-results-mobile");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(await page.evaluate(() => window.onlineApp.gs.tanks.map(t => t.cash)), beforeResults);
  await page.setViewportSize({ width: 1200, height: 900 });
  await click("Go");
  assert.match(await income.innerText(), /Resupply \+\$7,500/);
  assert.match(await income.innerText(), /Combat earnings \+\$12,000/);
  assert.match(await income.innerText(), /Victory \+\$7,500/);
  assert.match(await income.innerText(), /Recovery bonus \+\$0/);
  assert.equal(await page.evaluate(() => window.onlineApp.top.tank.cash), 37000);
  const breakdown = await income.innerText();
  await page.getByRole("button", { name: /^Missile, owned/ }).click(); await click("Update");
  assert.equal(await income.innerText(), breakdown, "Purchases change balance, not income history");
  await shot("comeback-winner-shop"); await click("Done");
  assert.match(await income.innerText(), /Recovery bonus \+\$500/);
  assert.match(await income.innerText(), /Total \+\$8,000/);
  assert.equal(await page.evaluate(() => window.onlineApp.top.tank.cash), 18000);
  await shot("comeback-recovery-shop");
  await page.setViewportSize({ width: 390, height: 844 });
  await income.scrollIntoViewIfNeeded(); await shot("comeback-mobile-shop");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await click("Done");
  await page.waitForFunction(() => window.onlineApp.gs.phase === "aim");
  await page.evaluate(() => {
    const app = window.onlineApp;
    app.gs.tanks[1].alive = false; app.gs._end_round(); app._act("round_end");
  });
  await settled();
  assert.equal(await goFocused(), true, "Final-round results focus Go");
  assert.equal(await results.locator("tbody tr").nth(0).locator("td").last().textContent(), "+$7,500");
  assert.equal(await results.locator("tbody tr").nth(1).locator("td").last().textContent(), "+$0");
  await page.keyboard.press("Enter"); await settled();
  assert.deepEqual(await results.locator("th").allTextContents(), ["Rank", "Player", "Score", "Wins", "Cash"]);
  assert.equal(await goFocused(), true, "Final standings focus Go");
  await shot("comeback-final-results");
  await page.evaluate(() => window.onlineApp._act("to_menu"));
}
