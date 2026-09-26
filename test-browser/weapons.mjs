// Run against npm run dev (default :5173). Advances every effect frame and
// captures representative PNGs, including the terrain after settling.
import { chromium } from "playwright";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const base = process.argv[2] ?? "http://localhost:5173";
const out = new URL("./out/weapons/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || ["/usr/bin/chromium", "/usr/bin/google-chrome"].find(existsSync),
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1050, height: 810 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/test-browser/harness.html`);
  await page.evaluate(() => window.harnessReady);
  // Verify successive real canvas frames, not just the final flame shape.
  for (const idx of [8, 9]) {
    await page.evaluate((i) => window.startWeaponDemo(i), idx);
    let meta;
    for (let n = 0; n < 200; n++) {
      meta = await page.evaluate(() => window.advanceWeaponDemo(1));
      if (meta.fluid[0]?.phase === "ignite") break;
    }
    assert.equal(meta.fluid[0]?.phase, "ignite");
    let previous = await page.locator("#game").screenshot();
    let disks = meta.fluid[0].disks;
    for (let row = 0; row < 4; row++) {
      meta = await page.evaluate(() => window.advanceWeaponDemo(1));
      assert.ok(meta.fluid[0].disks > disks, `item ${idx} did not grow a flame row`);
      const next = await page.locator("#game").screenshot({ path: `${out}/${idx}-ignite-${row}.png` });
      assert.ok(!next.equals(previous), `item ${idx} rendered a static flame`);
      previous = next; disks = meta.fluid[0].disks;
    }
  }
  const summary = [];
  for (const idx of Array.from({ length: 33 }, (_, i) => i)) for (const terrain of ["flat", "hill"]) {
    await page.evaluate(([i, t]) => window.startWeaponDemo(i, t), [idx, terrain]);
    const captures = new Set([0, 5, 10, 20, 40, 80, 120]);
    let meta;
    const start = performance.now();
    for (let frame = 0; frame <= 4000; frame += frame < 120 ? 1 : 10) {
      meta = await page.evaluate((n) => window.advanceWeaponDemo(n), frame ? (frame <= 120 ? 1 : 10) : 0);
      if (captures.has(frame) || (frame > 0 && meta.phase !== "firing")) {
        await page.locator("#game").screenshot({ path: `${out}/${idx}-${terrain}-${String(frame).padStart(4, "0")}.png` });
      }
      if (frame > 0 && meta.phase !== "firing") break;
    }
    assert.notEqual(meta.phase, "firing", `item ${idx} failed to finish`);
    assert.equal(meta.effects, 0);
    const before = await page.evaluate(() => window.weaponDemoTerrainStats());
    let settled;
    for (let i = 0; i < 300; i++) {
      settled = await page.evaluate(() => window.advanceWeaponDemo(1));
      if (["aim", "round_end", "game_over"].includes(settled.phase)) break;
    }
    assert.ok(["aim", "round_end", "game_over"].includes(settled.phase), `item ${idx} failed to settle`);
    const after = await page.evaluate(() => window.weaponDemoTerrainStats());
    assert.equal(after.unsupported, 0, `item ${idx} left suspended dirt`);
    assert.equal(after.dirt, before.dirt, `item ${idx} lost dirt while settling`);
    await page.locator("#game").screenshot({ path: `${out}/${idx}-${terrain}-settled.png` });
    summary.push({ idx, terrain, ...meta, unsupportedBefore: before.unsupported,
      unsupportedAfter: after.unsupported, captureMs: Math.round(performance.now() - start) });
  }
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/summary.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} finally { await browser.close(); }
