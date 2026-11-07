import assert from "node:assert/strict";
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || ["/usr/bin/chromium", "/usr/bin/google-chrome"].find(existsSync),
  args: ["--no-sandbox", "--disable-gpu"],
});
try {
  const page = await browser.newPage();
  await page.goto(`${process.argv[2] || "http://127.0.0.1:4188"}/test-browser/harness.html`);
  await page.evaluate(() => window.harnessReady);
  const result = await page.evaluate(async () => {
    await (await import("/test-browser/modern.ts")).scene("GRASS", "CITY");
    const { gs, renderer, render } = window.modernTest;
    gs.fire();
    let blast;
    for (let i = 0; i < 2400 && !blast; i++) {
      gs.update(1 / 60);
      blast = gs.projectiles.find(p => p.weaponEffect?.kind === "blast")?.weaponEffect;
    }
    if (!blast) throw new Error("No blast from normal launch");
    Object.assign(blast, { x: 512, y: gs.terrain.column_top(512) + 80, radius: 60, phase: "grow", grown: 12, cycle: 6 });
    const cells = gs.terrain.modern.cells.slice();
    const alpha = dx => renderer.modernRenderer.cutTerrain.getContext("2d").getImageData((blast.x + dx) * 2, blast.y * 2, 1, 1).data[3];
    render();
    const early = [alpha(0), alpha(30), alpha(65)];
    blast.grown = 60; blast.cycle = 30; render();
    const late = [alpha(0), alpha(30), alpha(65)];
    const png = () => renderer.modernFrame.toDataURL();
    const first = png(); render(); const repeatable = png() === first;
    blast.cycle++; render(); const moves = png() !== first;
    blast.plasma = true; render();
    const plasma = [alpha(0), alpha(30), alpha(65)];
    const unchanged = cells.every((v, i) => v === gs.terrain.modern.cells[i]);
    blast.plasma = false;
    blast.phase = "hold"; blast.cycle = 70; render();
    const settled = png();
    blast.cycle = 92; render();
    const noRepeat = png() === settled;
    // All sizes retain their circle after one short burst, with no re-emission
    // during the hold or when the cleanup phase begins.
    const { drawModernBlast } = await import("/src/modern_art.ts");
    const bursts = [];
    for (const radius of [10, 75, 225]) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = radius * 4 + 40;
      const ctx = canvas.getContext("2d"), center = canvas.width / 2;
      const growth = Math.ceil(radius / (radius < 40 ? 1 : 2));
      const frame = (age, fading = false) => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        drawModernBlast(ctx, center, center, radius, age, 1, false, fading, 0);
        return canvas.toDataURL();
      };
      const active = frame(growth);
      const quiet = frame(growth + 31);
      bursts.push({ radius, hadBurst: active !== quiet,
        expired: frame(growth + 53) === quiet,
        cleanupQuiet: frame(growth + 100, true) === quiet,
        ringVisible: ctx.getImageData(center + radius, center, 1, 1).data[3] > 0 });
    }
    blast.cycle = 30; render();
    return { early, late, plasma, repeatable, moves, unchanged, noRepeat, bursts };
  });
  assert.deepEqual(result.early, [0, 255, 255], "only the growing interior disappears");
  assert.deepEqual(result.late, [0, 0, 255], "terrain outside the blast stays visible");
  assert.deepEqual(result.plasma, [255, 255, 255], "plasma preserves terrain");
  assert.ok(result.repeatable && result.moves && result.unchanged && result.noRepeat);
  for (const burst of result.bursts) {
    assert.ok(burst.hadBurst && burst.expired && burst.cleanupQuiet && burst.ringVisible, `radius ${burst.radius}: one burst with a retained circle`);
  }
  mkdirSync("test-browser/out/modern", { recursive: true });
  await page.locator("#game").screenshot({ path: "test-browser/out/modern/particle-crater.png" });
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
