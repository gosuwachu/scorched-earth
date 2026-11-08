import assert from "node:assert/strict";
import { chromium } from "playwright";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
const base = process.argv[2] || "http://127.0.0.1:4317";
const out = "test-browser/out/modern";
mkdirSync(out, {recursive:true});
const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || ["/usr/bin/chromium","/usr/bin/google-chrome"].find(existsSync),args:["--no-sandbox","--disable-gpu","--disable-dev-shm-usage"]});
const errors = [], results = [];
const desertKinds = new Set();
async function checkDesertScenery(page, name) {
  const check = await page.evaluate(async () => {
    const { DesertLayers } = await import("/src/desert_layers.ts");
    const { desertScenery, drawDesertScenery, DESERT_SCENERY } = await import("/src/desert_scenery.ts");
    const world = window.modernTest.gs.terrain.modern;
    const layers = new DesertLayers(world.w, world.h, world.seed);
    const props = desertScenery(world);
    const sprites = new Map(await Promise.all(DESERT_SCENERY.map(async kind => {
      const image = new Image(); image.src = `/assets/modern/desert-v1/${kind}.png`;
      await image.decode(); return [kind, image];
    })));
    const reference = document.createElement("canvas"); reference.width = world.fw; reference.height = world.fh;
    drawDesertScenery(reference.getContext("2d"), world, kind => sprites.get(kind), layers);
    const expected = reference.getContext("2d").getImageData(0, 0, world.fw, world.fh).data;
    const actual = document.getElementById("game").getContext("2d").getImageData(0, 0, world.fw, world.fh).data;
    let supported = true, visiblePixels = 0, interior = 0;
    for (const p of props) {
      const contact = p.w * (p.kind === "shrub" ? .12 : .48);
      if (p.y > layers.column(p.x).sandBack + 2) interior++;
      for (let x = Math.floor((p.x - contact) * 2); x <= Math.ceil((p.x + contact) * 2); x++) {
        for (let y = Math.floor((p.y - 1) * 2); y <= Math.ceil((p.y + 1.5) * 2); y++) {
          if (!layers.sandContains(x / 2, y / 2) || world.cells[x * world.fh + y] !== 1) supported = false;
        }
      }
      // A sprite on the rear background would be hidden by the sand. Compare
      // opaque painted pixels inside the apron against the final game frame.
      for (let x = Math.floor((p.x - p.w / 2) * 2); x < (p.x + p.w / 2) * 2; x++) {
        for (let y = Math.floor((p.y - p.h) * 2); y < p.y * 2; y++) {
          if (!layers.sandContains(x / 2, y / 2)) continue;
          const i = (y * world.fw + x) * 4;
          if (expected[i + 3] < 240) continue;
          const error = Math.abs(actual[i] - expected[i]) + Math.abs(actual[i + 1] - expected[i + 1]) + Math.abs(actual[i + 2] - expected[i + 2]);
          if (error < 18) visiblePixels++;
        }
      }
    }
    return { kinds: props.map(p => p.kind), supported, interior, visiblePixels };
  });
  assert.ok(check.supported && check.interior > 3, `${name}: full scenery bases inside live sand`);
  assert.ok(check.visiblePixels > 40, `${name}: scenery painted visibly over the sand interior`);
  for (const kind of check.kinds) desertKinds.add(kind);
  assert.ok(await page.evaluate(() => window.modernTest.roundtrip()), `${name}: save restoration`);
  return check;
}
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
    if (layout === "MOUNTAINS") assert.ok(meta.relief > 768 * (biome === "DESERT" ? .30 : .7), `${name}: distinct peaks above the valley floor`);
    if (biome === "DESERT" && layout === "MOUNTAINS") meta.scenery = await checkDesertScenery(page, name);
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
    assert.ok(meta.relief > 768 * .30, `desert ${seed}: mesas above the continuous sand apron`);
    meta.scenery = await checkDesertScenery(page, `desert ${seed}`);
    assert.ok(await page.evaluate(() => window.modernTest.gs.tanks.every(t =>
      t.alive && t.health === 100 && window.modernTest.gs.terrain.is_supported(t.x, t.y, t.half_width))), `desert ${seed}: supported starts`);
    await page.locator("#game").screenshot({path:`${out}/desert-mountains-seed-${seed}.png`});
    results.push(meta);
  }
  assert.deepEqual([...desertKinds].sort(), ["adobe", "rock", "shrub", "truck"], "all four generated scenery types appear across desert seeds");
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
