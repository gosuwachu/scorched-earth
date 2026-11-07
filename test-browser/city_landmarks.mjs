import assert from "node:assert/strict";
import { chromium } from "playwright";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
const base = process.argv[2] || "http://127.0.0.1:4319";
const out = "test-browser/out/painted-buildings";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || ["/usr/bin/chromium", "/usr/bin/google-chrome"].find(existsSync), args: ["--no-sandbox", "--disable-gpu"] });
const errors = [], results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(`${base}/test-browser/harness.html`);
  await page.evaluate(() => window.harnessReady);
  const kinds = await page.evaluate(async () => [...(await import("/src/city_shapes.ts")).CITY_BUILDINGS, "house", "tower", "pine", "tree", "cactus"]);
  for (const kind of kinds) {
    const result = await page.evaluate(async kind => (await import("/test-browser/city_landmarks.ts")).landmarkScene(kind), kind);
    assert.ok(result.before > 200 && result.after > result.before * .98, `${kind}: connected silhouette`);
    assert.ok(Math.abs(result.aspect - result.actualAspect) < 1e-12, `${kind}: original proportions`);
    await page.locator("#game").screenshot({ path: `${out}/${kind}.png` });
    results.push(result);
  }
  for (const seed of [1, 2, 19, 71, 313]) {
    const meta = await page.evaluate(async seed => (await import("/test-browser/modern.ts")).scene("GRASS", "CITY", seed, 10), seed);
    assert.ok(meta.groundTanks >= 3 && meta.rooftopTanks >= 1, `city ${seed}: mixed ground and roof starts`);
    assert.ok(meta.buildingCoverage < .76 && meta.heightContrast > 3.5, `city ${seed}: open districts and height contrast`);
    await page.locator("#game").screenshot({ path: `${out}/district-seed-${seed}.png` });
    results.push(meta);
  }
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/summary.json`, JSON.stringify(results, null, 2));
  console.log(`PASS: ${kinds.length} painted scenery specimens and five ten-player district maps`);
} finally { await browser.close(); }
