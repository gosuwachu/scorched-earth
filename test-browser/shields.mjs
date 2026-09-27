// Run against npm run dev. Captures actual shield interactions over successive frames.
import { chromium } from "playwright";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";

const base = process.argv[2] ?? "http://localhost:5173";
const out = new URL("./out/shields/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || ["/usr/bin/chromium", "/usr/bin/google-chrome"].find(existsSync),
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1050, height: 810 } });
  const errors = [], summary = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/test-browser/harness.html`);
  await page.evaluate(() => window.harnessReady);
  const scenarios = [40, 41, 42, 43, 44].flatMap((item) => ["slow", "fast"].map((scenario) => ({ item, scenario })));
  for (const scenario of ["top", "left", "right"]) scenarios.push({ item: 42, scenario });
  for (const { item, scenario } of scenarios) {
    await page.evaluate(([i, s]) => window.startShieldDemo(i, s), [item, scenario]);
    const samples = [];
    let previous;
    const side = scenario === "left" || scenario === "right";
    // Side shots skim the ground: capture their departure before gravity lands them.
    for (const frames of side ? [0, 1, 1] : [0, 4, 4, 4, 8]) {
      const meta = await page.evaluate((n) => window.advanceShieldDemo(n), frames);
      const capture = await page.locator("#game").screenshot({ path: `${out}/${item}-${scenario}-${meta.frame}.png` });
      if (previous && samples.at(-1).active) assert.ok(!capture.equals(previous), `${item}/${scenario} has a static flight frame`);
      previous = capture; samples.push(meta);
    }
    const last = samples.at(-1);
    const magnetic = item === 40 || item === 44;
    if ((magnetic && scenario === "slow") || item === 42) {
      assert.equal(last.active, true, `${item}/${scenario} should keep flying`);
      if (side) assert.equal(Math.sign(last.vx), scenario === "left" ? -1 : 1);
      else assert.ok(last.vy > 0, `${item}/${scenario} did not turn upward`);
      assert.equal(last.health, 100);
    } else {
      assert.equal(last.active, false, `${item}/${scenario} should hit`);
    }
    if (magnetic && scenario === "slow") assert.equal(last.shield, item === 40 ? 55 : 200);
    if (item === 41 || item === 43 || (item === 44 && scenario === "fast")) {
      assert.equal(last.shield, (item === 41 ? 100 : item === 43 ? 150 : 200) - 10);
      assert.equal(last.health, 100);
    }
    if (item === 40 && scenario === "fast") assert.equal(last.health, 0);
    if (item === 42 && (scenario === "top" || side)) assert.equal(last.shield, 97);
    summary.push({ item, scenario, samples });
  }
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 2));
  console.log(`Passed ${summary.length} shield flight scenarios; captures: ${out}`);
} finally {
  await browser.close();
}
