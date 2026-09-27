import assert from "node:assert/strict";

/** Exercise help through real controls and the same mounted app as ui.mjs. */
export async function checkOptionHelp(page, { click, settled, shot }) {
  const menus = ["Sound", "Hardware", "Economics", "Landscape", "Physics", "Play Options", "Weapons"];
  const originalViewport = page.viewportSize();
  const original = await page.evaluate(() => window.onlineApp.cfg.save());
  const dialog = page.locator("dialog.ui-options[open]");
  const body = dialog.locator(".ui-panel-body");
  const close = async () => { await page.keyboard.press("Escape"); await settled(); };

  for (const [size, viewport] of [
    ["desktop", originalViewport],
    ["mobile", { width: 390, height: 844 }],
    ["short", { width: 800, height: 480 }],
  ]) {
    await page.setViewportSize(viewport);
    for (const menu of menus) {
      await click(`${menu}...`);
      assert.ok(await dialog.locator(".ui-option-help").count() > 0, `${menu} has inline help`);
      const issues = await dialog.evaluate((node) => {
        const issues = [];
        const bounds = node.getBoundingClientRect();
        const body = node.querySelector(".ui-panel-body");
        if (bounds.left < -1 || bounds.right > innerWidth + 1 || bounds.top < -1 || bounds.bottom > innerHeight + 1) issues.push("dialog outside viewport");
        if (node.scrollWidth > node.clientWidth || body.scrollWidth > body.clientWidth) issues.push("horizontal overflow");
        let bottom = 0;
        for (const row of body.children) {
          const rect = row.getBoundingClientRect();
          if (rect.top < bottom - 1) issues.push("overlapping rows");
          bottom = rect.bottom;
        }
        for (const row of body.querySelectorAll(".ui-described-widget")) {
          const help = row.querySelector(".ui-option-help");
          if (help.closest("label, button")) issues.push("help changes control name");
          if (help.getBoundingClientRect().top < row.firstElementChild.getBoundingClientRect().bottom - 1) issues.push("help overlaps control");
          for (const control of row.querySelectorAll("input, button")) {
            if (control.getAttribute("aria-describedby") !== help.id) issues.push("missing accessible description");
          }
        }
        const done = node.querySelector("[data-default]").getBoundingClientRect();
        if (done.top < bounds.top || done.bottom > bounds.bottom) issues.push("Done is clipped");
        const title = node.querySelector(".ui-title").getBoundingClientRect();
        if (title.top < bounds.top || title.bottom > bounds.bottom) issues.push("title is clipped");
        return issues;
      });
      assert.deepEqual(issues, [], `${size} ${menu}`);
      await shot(`help-${size}-${menu.toLowerCase().replaceAll(" ", "-")}`);
      // The end of long forms must be reachable without moving the footer.
      await body.evaluate((node) => { node.scrollTop = node.scrollHeight; });
      const lastRow = body.locator(":scope > *").last();
      assert.ok(await lastRow.isVisible());
      assert.ok(await lastRow.evaluate((node) => node.getBoundingClientRect().bottom <= node.parentElement.getBoundingClientRect().bottom + 1), "last setting can be scrolled into view");
      await click("Done");
      assert.equal(await page.evaluate(() => document.activeElement.textContent), `${menu}...`);
    }
  }

  await page.setViewportSize(originalViewport);
  await click("Hardware...");
  assert.ok(await page.getByRole("checkbox", { name: "Small Memory", exact: true }).isVisible());
  assert.match(await page.getByRole("checkbox", { name: "Small Memory", exact: true }).getAttribute("aria-describedby"), /^ui-help-/);
  await close();

  // Text and its accessible association update in place, without replacing the
  // focused button. Checking several enums catches stale/cross-wired help.
  for (const [menu, label, key, tokens, markers] of [
    ["Economics", "Scoring Mode:", "SCORING", ["BASIC", "STANDARD", "GREEDY"], ["Basic:", "Standard:", "Greedy:"]],
    ["Physics", "Effect of Walls:", "ELASTIC", ["NONE", "WRAP", "PADDED", "RUBBER", "SPRING", "CONCRETE", "RANDOM", "ERRATIC"], ["None:", "Wrap-around:", "Padded:", "Rubber:", "Spring:", "Concrete:", "Random:", "Erratic:"]],
    ["Play Options", "Mode:", "PLAY_MODE", ["SEQUENTIAL", "SYNCHRONOUS", "SIMULTANEOUS"], ["Sequential:", "Synchronous:", "Simultaneous:"]],
  ]) {
    await page.evaluate(({ key, first }) => { window.onlineApp.cfg[key] = first; }, { key, first: tokens[0] });
    await click(`${menu}...`);
    const next = page.getByRole("button", { name: `Increase ${label}`, exact: true });
    await next.focus();
    const handle = await next.elementHandle();
    const helpId = await next.getAttribute("aria-describedby");
    const help = page.locator(`#${helpId}`);
    for (let i = 0; i < tokens.length; i++) {
      assert.ok((await help.textContent()).includes(markers[i]));
      assert.equal(await page.evaluate((key) => window.onlineApp.cfg[key], key), tokens[i]);
      assert.ok(await handle.evaluate((node) => node === document.activeElement));
      // Keyboard changes use the same binding and retain help on the button.
      await page.keyboard.press("ArrowRight");
      assert.equal(await next.getAttribute("aria-describedby"), helpId);
    }
    await handle.dispose();
    await close();
  }

  await page.setViewportSize({ width: 390, height: 480 });
  await click("Weapons...");
  const list = dialog.locator(".ui-weapon-options-list");
  assert.equal(await list.getByRole("checkbox").count(), 8);
  await click("↓ More weapons");
  assert.equal(await page.evaluate(() => window.onlineApp.top.scroll), 8);
  await list.getByRole("checkbox").last().focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.textContent), "↑ Previous weapons");
  await click("↑ Previous weapons");
  assert.equal(await page.evaluate(() => window.onlineApp.top.scroll), 0);
  // Wheeling over descriptions scrolls the dialog, never the equipment page.
  await body.evaluate((node) => { node.scrollTop = 0; });
  await dialog.locator(".ui-option-help").first().hover();
  await page.mouse.wheel(0, 130);
  await page.waitForFunction(() => document.querySelector("dialog.ui-options .ui-panel-body").scrollTop > 0);
  assert.equal(await page.evaluate(() => window.onlineApp.top.scroll), 0);
  await list.getByRole("checkbox").first().focus();
  await list.getByRole("checkbox").first().hover();
  await page.mouse.wheel(0, 100);
  await page.waitForFunction(() => window.onlineApp.top.scroll === 1);
  assert.ok(await list.getByRole("checkbox").first().evaluate((node) => node === document.activeElement));
  await close();
  await page.setViewportSize(originalViewport);
  await page.evaluate(async (saved) => {
    const { Config } = await import("/src/config.ts");
    Object.assign(window.onlineApp.cfg, Config.load(saved));
  }, original);
}
