// Run against npm run dev. Captures actual shield interactions over successive frames.
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";

const base = process.argv[2] ?? "http://localhost:5173";
const reference = JSON.parse(readFileSync(new URL("../test/fixtures/dos_shields.json", import.meta.url), "utf8"));
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

  // Real muzzle-to-impact flights, armed through the player control panel.
  for (const item of [0, 40, 44]) for (const scenario of ["launch-slow", "launch-fast"]) {
    await page.evaluate(([i, s]) => window.startShieldDemo(i, s), [item, scenario]);
    const samples = [];
    for (let frame = 0; frame <= 150; frame += 5) {
      const meta = await page.evaluate((n) => window.advanceShieldDemo(n), frame ? 5 : 0);
      samples.push(meta);
      if (frame % 15 === 0 || !meta.active) await page.locator("#game").screenshot({ path: `${out}/${item}-${scenario}-${frame}.png` });
      if (!meta.active) break;
    }
    const last = samples.at(-1), slow = scenario === "launch-slow";
    assert.equal(last.active, false, `${item}/${scenario} never finished`);
    assert.equal(last.lifted, item !== 0 && slow, `${item}/${scenario} reversal`);
    assert.equal(last.health, item === 0 || (item === 40 && !slow) ? 0 : 100);
    if (item === 44) assert.equal(last.shield, slow ? 200 : 190);
    summary.push({ item, scenario, samples });
  }

  const act = (action, value = 0) => page.evaluate(([a, v]) => window.advanceShieldVisualDemo(a, v), [action, value]);
  const start = (item) => page.evaluate((i) => window.startShieldVisualDemo(i), item);
  const checkColor = (meta, expected, label) => {
    assert.deepEqual(meta.rgb, expected, `${label}: outline`);
    assert.deepEqual(meta.swatch, expected, `${label}: swatch`);
  };
  const visual = [];
  for (const f of reference.shields) {
    await start(f.item);
    const samples = [];
    for (let frame = 0; frame < 51; frame++) {
      const meta = await act(frame ? "age" : "read", 1);
      checkColor(meta, f.activation[frame], `${f.item}/activation/${frame}`);
      samples.push(meta.rgb);
      if ([0, 25, 50].includes(frame)) await page.locator("#game").screenshot({ path: `${out}/${f.item}-activate-${frame}.png` });
    }
    await act("age", 1);
    for (const sample of f.colors.filter((c) => c.hp > 0).reverse()) {
      const before = await act("read");
      const meta = await act("damage", before.hp - sample.hp);
      checkColor(meta, sample.rgb, `${f.item}/strength/${sample.hp}`);
      checkColor(await act("team", 0x6e), sample.rgb, `${f.item}/red-team/${sample.hp}`);
      checkColor(await act("team", 0x77), sample.rgb, `${f.item}/blue-team/${sample.hp}`);
      await page.locator("#game").screenshot({ path: `${out}/${f.item}-strength-${sample.hp}.png` });
    }
    await act("damage", 1);
    await act("move", 50); // collapse stays at the position where it happened
    for (let frame = 0; frame < 51; frame++) {
      const meta = await act(frame ? "age" : "read", 1);
      assert.equal(meta.hp, 0); assert.equal(meta.item, 0);
      checkColor(meta, f.collapse[frame], `${f.item}/collapse/${frame}`);
      if ([0, 25, 50].includes(frame)) await page.locator("#game").screenshot({ path: `${out}/${f.item}-collapse-${frame}.png` });
    }
    const gone = await act("age", 1);
    assert.equal(gone.fade, null);
    assert.deepEqual(gone.rgb, gone.background, `${f.item}/collapsed outline must disappear`);
    visual.push({ item: f.item, activation: samples, strengths: f.colors });
  }

  // Manual activation, damage during deployment, laser recharge, replacement,
  // cancellation, and terrain clipping use the actual UI/combat/render paths.
  await start(44);
  await act("manual", 0);
  let meta = await act("manual", 44);
  assert.equal(meta.fade.dir, 1); assert.equal(meta.fade.frame, 0);
  checkColor(meta, [0, 0, 0], "manual activation");
  await act("age", 25);
  meta = await act("damage", 150);
  assert.equal(meta.fade, null); checkColor(meta, [60, 52, 32], "damage interrupts activation");
  meta = await act("recharge", 50);
  checkColor(meta, [124, 104, 64], "Super Mag laser recharge");
  await act("damage", 100);
  meta = await act("manual", 42);
  assert.equal(meta.fade.item, 42); assert.equal(meta.fade.dir, 1);
  await act("age", 51);
  checkColor(await act("read"), [252, 92, 252], "replacement shield");
  meta = await act("bury");
  assert.notDeepEqual(meta.rgb, [252, 92, 252], "dirt must cover shield outline");
  meta = await act("manual", 0);
  assert.equal(meta.fade, null); assert.equal(meta.hp, 0);

  assert.deepEqual(errors, []);
  writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 2));
  writeFileSync(`${out}/palette.json`, JSON.stringify(visual, null, 2));
  console.log(`Passed ${summary.length} shield flight scenarios, all five DOS palettes/fades, and visual lifecycle checks; captures: ${out}`);
} finally {
  await browser.close();
}
