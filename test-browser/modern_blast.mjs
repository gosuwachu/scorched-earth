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
    const { startBlast } = await import("/src/combat_effects.ts");
    const shot = gs.projectiles.find(p => p.weaponEffect === blast);
    startBlast(gs, shot, 512, gs.terrain.column_top(512) + 80, 60);
    gs.projectiles = [gs.projectiles.at(-1)];
    blast = gs.projectiles[0].weaponEffect;
    Object.assign(blast, { grown: 12, cycle: 6 });
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
    const surfaceAnimates = png() !== settled;
    // All sizes emit one short burst, leaving no outline or re-emission
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
        fullyClear: !ctx.getImageData(0, 0, canvas.width, canvas.height).data.some((v, i) => i % 4 === 3 && v > 0) });
    }
    // Exercise the actual composite for small, Baby Nuke, Nuke and larger blasts.
    const composites = [];
    for (const radius of [10, 40, 75, 225]) {
      startBlast(gs, shot, 512, 384, radius);
      gs.projectiles = [gs.projectiles.at(-1)];
      const effect = gs.projectiles[0].weaponEffect;
      Object.assign(effect, { grown: radius, cycle: Math.ceil(radius / (radius < 40 ? 1 : 2)) });
      render();
      const pixels = renderer.modernFrame.getContext("2d").getImageData(
        (512 - radius) * 2, (384 - radius) * 2, radius * 4, radius * 4).data;
      let red = 0, fire = 0, translucentRed = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > 60 && pixels[i] > pixels[i + 1] * 1.5 && pixels[i] > pixels[i + 2] * 1.5) {
          red++;
          if (pixels[i + 1] > 0 && pixels[i + 2] > 0) translucentRed++;
        }
        if (pixels[i] > 200 && pixels[i + 1] > 100 && pixels[i + 1] < 220 && pixels[i + 2] < 80) fire++;
      }
      composites.push({ radius, red, fire, translucentRed });
    }
    return { early, late, plasma, repeatable, moves, unchanged, surfaceAnimates, bursts, composites };
  });
  assert.deepEqual(result.early, [0, 255, 255], "only the growing interior disappears");
  assert.deepEqual(result.late, [0, 0, 255], "terrain outside the blast stays visible");
  assert.deepEqual(result.plasma, [255, 255, 255], "plasma preserves terrain");
  assert.ok(result.repeatable && result.moves && result.unchanged && result.surfaceAnimates);
  for (const burst of result.bursts) {
    assert.ok(burst.hadBurst && burst.expired && burst.cleanupQuiet && burst.fullyClear, `radius ${burst.radius}: one burst without a retained outline`);
  }
  for (const composite of result.composites) {
    assert.ok(composite.red > 0 && composite.fire > 0 && composite.translucentRed > 0, `radius ${composite.radius}: red plasma and fire particles visible together`);
  }
  mkdirSync("test-browser/out/modern", { recursive: true });
  await page.locator("#game").screenshot({ path: "test-browser/out/modern/particle-crater.png" });
  console.log(JSON.stringify(result));
} finally {
  await browser.close();
}
