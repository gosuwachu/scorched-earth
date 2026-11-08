import assert from "node:assert/strict";
import { chromium } from "playwright";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const base = process.argv[2] || "http://127.0.0.1:4268";
const out = process.argv[3] || "test-browser/out/terrain-depth";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ||
  ["/usr/bin/chromium", "/usr/bin/google-chrome"].find(existsSync),
  args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const results = [], errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  page.on("pageerror", error => errors.push(String(error)));
  await page.goto(`${base}/test-browser/harness.html`);
  await page.evaluate(() => window.harnessReady);
  await page.evaluate(async () => {
    for (const name of ["sandstone", "granite", "soil"]) {
      const image = new Image(); image.src = `/assets/modern/terrain-v3/${name}.webp`;
      await image.decode();
      if (image.naturalWidth < 1000) throw new Error(`Missing painted material: ${name}`);
    }
  });
  const contact = await page.evaluate(async () => {
    const { caveShade } = await import("/src/terrain_depth.ts");
    const fw = 160, fh = 240, width = fw / 4, height = fh / 4;
    const coarse = document.createElement("canvas"), fine = document.createElement("canvas");
    coarse.width = width; coarse.height = height; fine.width = fw; fine.height = fh;
    const source = coarse.getContext("2d"), target = fine.getContext("2d");
    let weakest = 255, checks = 0;
    for (const slope of [0, .25, -.25]) for (let offset = 0; offset < 4; offset++) {
      const cells = new Uint8Array(fw * fh);
      for (let x = 0; x < fw; x++) {
        const roofEnd = 52 + offset + Math.floor((x - 80) * slope);
        cells.fill(2, x * fh + 8, x * fh + roofEnd);
        cells.fill(2, x * fh + 160, x * fh + 180);
      }
      const shade = caveShade(cells, fw, fh), pixels = source.createImageData(width, height);
      shade.forEach((alpha, i) => { pixels.data[i * 4 + 3] = alpha; });
      source.putImageData(pixels, 0, 0);
      target.clearRect(0, 0, fw, fh); target.drawImage(coarse, 0, 0, fw, fh);
      for (const x of [48, 80, 112]) {
        const y = 52 + offset + Math.floor((x - 80) * slope);
        const edge = target.getImageData(x, y, 1, 1).data[3];
        weakest = Math.min(weakest, edge); checks++;
      }
    }
    return { weakest, checks };
  });
  assert.ok(contact.weakest > 180, `cave shadow must meet the roof after Canvas smoothing: ${JSON.stringify(contact)}`);
  console.log("cave roof contact", JSON.stringify(contact));
  for (const [biome, layout, seed] of [
    ["DESERT", "MOUNTAINS", 19], ["DESERT", "MOUNTAINS", 71],
    ["GRASS", "MOUNTAINS", 19], ["SNOW", "MOUNTAINS", 71],
    ["SWAMP", "CAVE", 71], ["GRASS", "CITY", 19],
  ]) {
    const meta = await page.evaluate(async ([b, l, s]) =>
      (await import("/test-browser/modern.ts")).scene(b, l, s, 4), [biome, layout, seed]);
    const name = `${biome.toLowerCase()}-${layout.toLowerCase()}-${seed}`;
    await page.locator("#game").screenshot({ path: `${out}/${name}.png` });
    const check = await page.evaluate(async () => {
      const { ModernRenderer } = await import("/src/modern_render.ts");
      const { ModernWorld } = await import("/src/modern.ts");
      const { Surface } = await import("/src/pygame.ts");
      const { gs, render } = window.modernTest;
      const world = gs.terrain.modern, renderer = new ModernRenderer();
      const surface = new Surface([world.w, world.h]);
      const draw = (r, m) => {
        r.prepare(m, surface); r.finish(surface);
        return r.frame.getContext("2d").getImageData(0, 0, world.fw, world.fh).data;
      };
      const same = (a, b) => a.every((v, i) => v === b[i]);
      const cells = world.cells.slice();
      const first = draw(renderer, world);
      const cached = same(first, draw(renderer, world));
      const unmodified = same(cells, world.cells);
      // Exercise both sides of fine-grid tile boundaries, then settling.
      for (const x of [255, 512, 769]) {
        const y = gs.terrain.column_top(x);
        world.circle(x, y + 8, 28);
      }
      let bedrockCut = null;
      if (world.biome === "DESERT" && world.layout === "MOUNTAINS") {
        const { DesertLayers } = await import("/src/desert_layers.ts");
        const layers = new DesertLayers(world.w, world.h, world.seed);
        const x = world.w * .65, bottom = layers.column(x).bedBottom;
        const y = (bottom + world.h) / 2, radius = Math.min(18, (world.h - bottom) * .2);
        if (layers.sample(x, y).layer !== 3 || !world.solid(x, y))
          throw new Error("Bedrock damage check must begin inside solid layer 3");
        world.circle(x, y, radius);
        if (world.solid(x, y)) throw new Error("Bedrock damage check did not excavate layer 3");
        bedrockCut = { x, y, radius };
      }
      const start = performance.now();
      const damaged = draw(renderer, world);
      const damageRenderMs = performance.now() - start;
      const rebuilt = same(damaged, draw(new ModernRenderer(), world));
      world.settle();
      const settled = draw(renderer, world);
      const settledRebuilt = same(settled, draw(new ModernRenderer(), world));
      const restored = ModernWorld.restore(world.serialize(), world.w, world.h);
      const reload = same(settled, draw(new ModernRenderer(), restored));
      render();
      return { cached, unmodified, rebuilt, settledRebuilt, reload, damageRenderMs, bedrockCut };
    });
    for (const flag of ["cached", "unmodified", "rebuilt", "settledRebuilt", "reload"])
      assert.equal(check[flag], true, `${name}: ${flag}`);
    await page.locator("#game").screenshot({ path: `${out}/${name}-damaged.png` });
    results.push({ ...meta, ...check });
    console.log(name, JSON.stringify(check));
  }
  assert.deepEqual(errors, []);
  writeFileSync(`${out}/summary.json`, JSON.stringify(results, null, 2));
} finally { await browser.close(); }
