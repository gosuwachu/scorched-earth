import assert from "node:assert/strict";
import { chromium } from "playwright";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
const base = process.argv[2] || "http://127.0.0.1:4317";
const out = "test-browser/out/modern";
mkdirSync(out, {recursive:true});
const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || ["/usr/bin/chromium","/usr/bin/google-chrome"].find(existsSync),args:["--no-sandbox","--disable-gpu","--disable-dev-shm-usage"]});
const errors = [], results = [];
try {
  const page = await browser.newPage({viewport:{width:1024,height:768}});
  page.on("pageerror", e=>errors.push(String(e)));
  await page.goto(`${base}/test-browser/harness.html`);
  await page.evaluate(()=>window.harnessReady);
  for(const [biome,layout] of [["GRASS","MOUNTAINS"],["SNOW","MOUNTAINS"],["DESERT","MOUNTAINS"],["SWAMP","MOUNTAINS"],["SWAMP","CAVE"],["GRASS","CITY"]]) {
    const meta = await page.evaluate(async ([b,l])=>(await import("/test-browser/modern.ts")).scene(b,l),[biome,layout]);
    const name = `${biome.toLowerCase()}-${layout.toLowerCase()}`;
    assert.ok(meta.propKinds.every(kind => kind !== "car" && kind !== "animal"), `${name}: no cars or animals`);
    if (biome === "DESERT" && layout === "MOUNTAINS") assert.ok(meta.propKinds.includes("rock"), `${name}: visible ground rocks`);
    if (layout === "MOUNTAINS") assert.ok(meta.relief > 768 * .7, `${name}: tall peaks and deep valleys`);
    if (layout === "MOUNTAINS" && ["GRASS", "SNOW"].includes(biome)) assert.ok(meta.caveAir > 1024 * 768 * .005, `${name}: underground cave space`);
    if (layout === "CITY") assert.ok(meta.buildingCoverage < .76 && meta.heightContrast > 3.5 && meta.relief > 40 && meta.groundTanks > 0, `${name}: open districts, contrasting heights and ground starts`);
    await page.locator("#game").screenshot({path:`${out}/${name}.png`});
    const flight = await page.evaluate(()=>window.modernTest.fire());
    for (const [phase, png] of Object.entries(flight.captures)) writeFileSync(`${out}/${name}-blast-${phase}.png`, Buffer.from(png.split(",")[1], "base64"));
    delete flight.captures;
    assert.ok(flight.visibleFrames >= 10 && flight.changedPixels > 40, `${name}: Baby Missile has visible opaque explosion frames`);
    assert.ok(flight.steps < 2400 && flight.changed, `${name}: normal shot must finish and damage terrain`);
    await page.locator("#game").screenshot({path:`${out}/${name}-shot.png`});
    const destruction = await page.evaluate(()=>window.modernTest.crater());
    assert.ok(await page.evaluate(()=>window.modernTest.roundtrip()), `${name}: save restoration`);
    await page.locator("#game").screenshot({path:`${out}/${name}-crater.png`});
    results.push({...meta,flight,destruction}); console.log(JSON.stringify(results.at(-1)));
  }
  for (const slot of [1, 2, 3]) {
    await page.evaluate(async () => (await import("/test-browser/modern.ts")).scene("GRASS", "MOUNTAINS"));
    const flight = await page.evaluate(slot => window.modernTest.fire(slot), slot);
    assert.ok(flight.visibleFrames >= 10 && flight.changedPixels > 40 && flight.changed && flight.steps < 2400, `weapon ${slot}: visible blast and completed destruction`);
    for (const [phase, png] of Object.entries(flight.captures)) writeFileSync(`${out}/weapon-${slot}-${phase}.png`, Buffer.from(png.split(",")[1], "base64"));
    delete flight.captures;
    results.push({slot, flight});
  }
  for (const seed of [1, 19, 313]) {
    const meta = await page.evaluate(async seed => (await import("/test-browser/modern.ts")).scene("DESERT", "MOUNTAINS", seed, 10), seed);
    assert.ok(meta.relief > 768 * .7, `desert ${seed}: mesa and canyon relief`);
    assert.ok(await page.evaluate(() => window.modernTest.gs.tanks.every(t =>
      t.alive && t.health === 100 && window.modernTest.gs.terrain.is_supported(t.x, t.y, t.half_width))), `desert ${seed}: supported starts`);
    await page.locator("#game").screenshot({path:`${out}/desert-mountains-seed-${seed}.png`});
    results.push(meta);
  }
  for (const seed of [1, 19, 313]) {
    const meta = await page.evaluate(async seed => (await import("/test-browser/modern.ts")).scene("GRASS", "MOUNTAINS", seed), seed);
    assert.ok(meta.relief > 768 * .7 && meta.propKinds.every(kind => kind !== "car" && kind !== "animal"));
    await page.locator("#game").screenshot({path:`${out}/grass-mountains-seed-${seed}.png`});
    results.push(meta);
  }
  for (const seed of [1, 19, 313]) {
    const meta = await page.evaluate(async seed => (await import("/test-browser/modern.ts")).scene("GRASS", "CITY", seed, 10), seed);
    assert.ok(meta.buildingCoverage < .76 && meta.heightContrast > 3.5 && meta.relief > 40 && meta.rooftopTanks > 0 && meta.groundTanks >= 3, `city ${seed}: districts and mixed ten-player starts`);
    await page.locator("#game").screenshot({path:`${out}/city-seed-${seed}.png`});
    results.push(meta);
  }
  assert.deepEqual(errors,[]);
  writeFileSync(`${out}/summary.json`,JSON.stringify(results,null,2));
} finally { await browser.close(); }
