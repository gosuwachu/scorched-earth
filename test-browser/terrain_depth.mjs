import assert from "node:assert/strict";
import { chromium } from "playwright";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const base = process.argv[2] || "http://127.0.0.1:4268";
const out = "test-browser/out/terrain-depth";
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
      return { cached, unmodified, rebuilt, settledRebuilt, reload, damageRenderMs };
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
