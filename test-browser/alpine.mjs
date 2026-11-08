import assert from "node:assert/strict";
import { chromium } from "playwright";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
const base = process.argv[2] || "http://127.0.0.1:4188";
const out = "test-browser/out/alpine";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ||
  ["/usr/bin/chromium", "/usr/bin/google-chrome"].find(existsSync), args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
const errors = [], results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(`${base}/test-browser/harness.html`);
  await page.evaluate(() => window.harnessReady);
  for (const biome of ["GRASS", "SNOW"]) for (const seed of [1, 19, 71, 313]) {
    const meta = await page.evaluate(async ([biome, seed]) =>
      (await import("/test-browser/modern.ts")).scene(biome, "MOUNTAINS", seed, 4), [biome, seed]);
    assert.ok(meta.caveTanks > 0 && meta.caveTanks < 4, "mix cave and surface spawns");
    assert.ok(meta.propKinds.filter(kind => kind === "rock").length > 0, "cave rocks and rubble are present");
    const outside = await page.evaluate(() => {
      const m = window.modernTest.gs.terrain.modern;
      return m.props.filter(p => p.kind === "rock" && p.y - p.h < m.surface[Math.round(p.x * 2)]).length;
    });
    assert.equal(outside, 0, "alpine rocks remain inside caves");
    assert.ok(meta.caveAir > 1024 * 768 * .005, "chambers remain open after tank placement");
    await page.locator("#game").screenshot({ path: `${out}/${biome}-${seed}.png` });
    const flight = await page.evaluate(() => window.modernTest.fire());
    assert.ok(flight.changed && flight.steps < 2400 && flight.visibleFrames >= 10);
    delete flight.captures;
    assert.ok(await page.evaluate(() => window.modernTest.roundtrip()));
    await page.locator("#game").screenshot({ path: `${out}/${biome}-${seed}-shot.png` });
    results.push({ ...meta, flight });
  }
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/summary.json`, JSON.stringify(results, null, 2));
  console.log(`Passed ${results.length} alpine scenes, shots and save roundtrips`);
} finally { await browser.close(); }
