import assert from "node:assert/strict";

/** Exercise help through real controls and the same mounted app as ui.mjs. */
export async function checkOptionHelp(page, { click, settled, shot }) {
  const menus = ["Sound", "Hardware", "Economics", "Landscape", "Physics", "Play Options", "Weapons"];
  const originalViewport = page.viewportSize();
  const original = await page.evaluate(() => window.onlineApp.cfg.save());
  const dialog = page.locator("dialog.ui-options[open]");
  const body = dialog.locator(".ui-panel-body");
  const close = async () => { await page.keyboard.press("Escape"); await settled(); };
  const removedOptions = {
    Hardware: [
      ["BIOS_KEYBOARD", "Bios Keyboard", "b"],
      ["LOWMEM", "Small Memory", "s"],
      ["MOUSE_RATE", "Mouse Rate:", "m"],
      ["FALLING_DELAY", "Falling Delay:", "d"],
      ["FAST_COMPUTERS", "Fast Computers", "f"],
    ],
    Landscape: [["LAND2", "Slope:", "l"]],
    "Play Options": [
      ["DAMAGE_TANKS_ON_IMPACT", "Impact Damage", "i"],
      ["TUNNELLING", "Tunneling", "t"],
      ["EXTRA_DIRT", "Extra Dirt", "e"],
      ["USELESS_ITEMS", "Useless Items", "u"],
    ],
  };
  // Existing configurations can still carry non-default values for hidden fields.
  const storedValues = {
    BIOS_KEYBOARD: "ON", LOWMEM: "ON", MOUSE_RATE: 2.5, FALLING_DELAY: 47,
    FAST_COMPUTERS: "ON", LAND2: 73, DAMAGE_TANKS_ON_IMPACT: "OFF",
    TUNNELLING: "ON", EXTRA_DIRT: "ON", USELESS_ITEMS: "OFF",
  };
  await page.evaluate((values) => Object.assign(window.onlineApp.cfg, values), storedValues);

  for (const [size, viewport] of [
    ["desktop", originalViewport],
    ["mobile", { width: 390, height: 844 }],
    ["short", { width: 800, height: 480 }],
  ]) {
    await page.setViewportSize(viewport);
    for (const menu of menus) {
      await click(`${menu}...`);
      assert.ok(await dialog.locator(".ui-option-help").count() > 0, `${menu} has inline help`);
      const bindings = await page.evaluate(() => [...window.onlineApp.top.optionKeys.values()]);
      for (const [key, label] of removedOptions[menu] ?? []) {
        assert.ok(!bindings.includes(key), `${menu}: ${key} has no widget or accelerator`);
        assert.equal(await dialog.getByRole(label.endsWith(":") ? "group" : "checkbox", { name: label, exact: true }).count(), 0, `${menu}: ${label} is absent`);
      }
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
  for (const [menu, options] of Object.entries(removedOptions)) {
    for (const [key, , shortcut] of options) {
      await click(`${menu}...`);
      await dialog.getByRole("button", { name: "Done", exact: true }).focus();
      await page.keyboard.press(shortcut);
      await settled();
      assert.equal(await page.evaluate((key) => window.onlineApp.cfg[key], key), storedValues[key], `${key} cannot be changed by its old shortcut`);
      // A retained control may share the shortcut (including Done).
      if (await dialog.count()) await close();
    }
  }
  const roundTripped = await page.evaluate(async (keys) => {
    const { Config } = await import("/src/config.ts");
    const cfg = Config.load(window.onlineApp.cfg.save());
    return Object.fromEntries(keys.map((key) => [key, cfg[key]]));
  }, Object.keys(storedValues));
  assert.deepEqual(roundTripped, storedValues, "hidden settings survive configuration save/load");

  await click("Hardware...");
  for (const label of ["Graphics Mode:", "Pointer:", "Firing Delay:"]) {
    assert.ok(await dialog.getByRole("group", { name: label, exact: true }).isVisible());
  }
  assert.ok(await dialog.getByRole("button", { name: "Calibrate Joystick", exact: true }).isVisible());
  const firingDelay = await page.evaluate(() => window.onlineApp.cfg.FIRE_DELAY);
  await click("Increase Firing Delay:");
  assert.equal(await page.evaluate(() => window.onlineApp.cfg.FIRE_DELAY), firingDelay + 1);
  assert.match(await dialog.getByRole("group", { name: "Firing Delay:", exact: true }).getAttribute("aria-describedby"), /^ui-help-/);
  await close();
  await click("Play Options...");
  for (const label of ["Attack File:", "Die File:"]) {
    assert.ok(await dialog.getByRole("textbox", { name: label, exact: true }).isVisible());
  }
  await close();

  // Text and its accessible association update in place, without replacing the
  // focused button. Checking several enums catches stale/cross-wired help.
  for (const [menu, label, key, tokens, markers] of [
    ["Economics", "Scoring Mode:", "SCORING", ["BASIC", "STANDARD", "GREEDY"], ["Basic:", "Standard:", "Greedy:"]],
    ["Physics", "Effect of Walls:", "ELASTIC", ["NONE", "WRAP", "PADDED", "RUBBER", "SPRING", "CONCRETE", "RANDOM", "ERRATIC"], ["None:", "Wrap-around:", "Padded:", "Rubber:", "Spring:", "Concrete:", "Random:", "Erratic:"]],
    ["Play Options", "Mode:", "PLAY_MODE", ["SEQUENTIAL", "SYNCHRONOUS", "SIMULTANEOUS"], ["Sequential:", "Synchronous:", "Simultaneous:"]],
    ["Play Options", "Teams:", "TEAM_MODE", ["NONE", "STANDARD", "CORPORATE", "VICIOUS"], ["None:", "Standard:", "Corporate:", "Vicious:"]],
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
