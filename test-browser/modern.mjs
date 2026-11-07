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
  assert.deepEqual(errors,[]);
  writeFileSync(`${out}/summary.json`,JSON.stringify(results,null,2));
} finally { await browser.close(); }
