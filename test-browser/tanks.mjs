// Browser artwork checks; these do not claim DOS visual fidelity.
import assert from "node:assert/strict";
import { settledDialogs } from "./dialogs.mjs";
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";

const base = process.argv[2] || "http://127.0.0.1:4188";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || ["/usr/bin/chromium", "/usr/bin/google-chrome"].find(existsSync),
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1120, height: 620 } });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.goto(`${base}/test-browser/harness.html`);
  await page.evaluate(() => window.harnessReady);
  const results = await page.evaluate(async () => {
    const { drawModernTank } = await import("/src/modern_art.ts");
    const canvas = document.createElement("canvas");
    canvas.width = 1120; canvas.height = 620;
    document.body.replaceChildren(canvas);
    document.body.style.cssText = "margin:0;background:#182630";
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#182630"; ctx.fillRect(0, 0, 1120, 620);
    ctx.fillStyle = "#e1edf2"; ctx.font = "22px sans-serif";
    ctx.fillText("Seven tank silhouettes · same player colour", 30, 40);
    const names = ["Howitzer", "Heavy tank", "Field gun", "Armoured car", "Wide turret", "Emplacement", "Command tank"];
    const results = [];
    for (const [row, angle] of [30, 90, 150].entries()) {
      const images = [];
      for (let design = 0; design < 7; design++) {
        const tile = document.createElement("canvas"); tile.width = 160; tile.height = 140;
        drawModernTank(tile.getContext("2d"), 75, 115, 95, [64, 201, 222], angle, design);
        images.push(tile.toDataURL());
        ctx.drawImage(tile, design * 160, 65 + row * 175);
        ctx.fillStyle = "#d7e7ee"; ctx.font = "14px sans-serif";
        ctx.fillText(names[design], design * 160 + 15, 215 + row * 175);
      }
      results.push({ angle, width: 95, unique: new Set(images).size });
      // Also verify distinct rasterised artwork at actual battle scale.
      const small = [];
      for (let design = 0; design < 7; design++) {
        const tile = document.createElement("canvas"); tile.width = 48; tile.height = 36;
        drawModernTank(tile.getContext("2d"), 22, 28, 26, [64, 201, 222], angle, design);
        small.push(tile.toDataURL());
        ctx.drawImage(tile, design * 160 + 110, 170 + row * 175);
      }
      results.push({ angle, width: 26, unique: new Set(small).size });
    }
    return results;
  });
  for (const result of results) assert.equal(result.unique, 7, JSON.stringify(result));
  assert.deepEqual(errors, []);
  mkdirSync("test-browser/out", { recursive: true });
  await page.screenshot({ path: "test-browser/out/tank-designs.png" });
  await page.goto(`${base}/test-browser/online_host.html`);
  await page.waitForFunction(() => !!window.onlineApp);
  const click = async name => {
    await settledDialogs(page);
    await page.getByRole("button", { name, exact: true }).click();
    await settledDialogs(page);
  };
  for (const name of ["Start", "Local", "Continue"]) await click(name);
  const designs = page.getByRole("button", { name: /^Tank design / });
  assert.equal(await designs.count(), 7);
  const previews = await designs.locator("canvas").evaluateAll(nodes => nodes.map(c => c.toDataURL()));
  assert.equal(new Set(previews).size, 7, "all seven picker previews are distinct");
  for (let i = 1; i <= 6; i++) {
    await click(`Tank design ${i}`);
    assert.equal(await page.getByRole("button", { name: `Tank design ${i}`, exact: true }).getAttribute("aria-pressed"), "true");
  }
  await page.screenshot({ path: "test-browser/out/tank-picker.png" });
  assert.deepEqual(errors, []);
  console.log("Seven distinct tank designs at preview and battle sizes, angles 30/90/150: passed");
} finally {
  await browser.close();
}
