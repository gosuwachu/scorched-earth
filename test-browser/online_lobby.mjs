import assert from "node:assert/strict";
import { WebSocket } from "ws";

export async function checkJoinWithoutStorage(browser, host, joinUrl, until) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  try {
    await context.addInitScript(() => {
      Object.defineProperty(window, "localStorage", { get() { throw new DOMException("Storage blocked", "SecurityError"); } });
      const Socket = window.WebSocket;
      window.joinResponses = [];
      window.WebSocket = class extends Socket {
        constructor(...args) {
          super(...args);
          if (!String(args[0]).endsWith("/online")) return;
          window.onlineSocket = this;
          let discarded = false;
          this.addEventListener("message", (event) => {
            if (discarded) { event.stopImmediatePropagation(); return; }
            const message = JSON.parse(event.data);
            if (message.type !== "joined") return;
            window.joinResponses.push(message);
            if (window.joinResponses.length === 1) {
              discarded = true;
              event.stopImmediatePropagation();
              this.close();
            }
          });
        }
      };
    });
    const phone = await context.newPage();
    const errors = [];
    phone.on("pageerror", (error) => errors.push(String(error)));
    await phone.goto(joinUrl);
    await phone.getByPlaceholder("Your name").waitFor();
    assert.match(await phone.locator(".lan-error").innerText(), /Browser storage is unavailable/);
    await phone.evaluate(() => window.onlineSocket.close());
    await until(async () => await phone.evaluate(() => window.joinResponses.length === 3), "in-memory token reconnects without storage");
    const responses = await phone.evaluate(() => window.joinResponses);
    assert.equal(new Set(responses.map((r) => r.player)).size, 1, "Initial retries and token reconnects retain one identity without storage");
    await until(async () => await host.evaluate(() => window.onlineApp.online.room.players.length === 1 &&
      window.onlineApp.online.room.players[0].connected), "one connected player without storage");
    assert.deepEqual(errors, []);
    await host.locator(`.lan-roster [data-player-id="${responses[0].player}"]`).getByRole("button").click();
    await until(async () => await host.locator(".lan-roster li").count() === 0, "temporary storage test player removed");
    console.log("PASS: interrupted initial join and token reconnect retain one player when browser storage is blocked");
  } finally {
    await context.close();
  }
}

/** A legacy client that leaves a default Player behind, as in the reported bug. */
export async function abandonedPlayer(base, joinUrl) {
  const socket = new WebSocket(`${base.replace(/^http/, "ws")}/online`);
  try {
    const joined = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Abandoned player join timed out")), 5000);
      socket.on("error", (error) => { clearTimeout(timer); reject(error); });
      socket.on("open", () => socket.send(JSON.stringify({ type: "join", room: new URL(joinUrl).searchParams.get("join") })));
      socket.on("message", (data) => {
        const message = JSON.parse(String(data));
        if (message.type === "joined") { clearTimeout(timer); resolve(message); }
      });
    });
    await new Promise((resolve) => { socket.once("close", resolve); socket.close(); });
    return joined.player;
  } finally {
    socket.terminate();
  }
}

/** The first joined response was discarded before the controller saw it. */
export async function checkInitialJoin(host, phone, until) {
  const lost = await phone.evaluate(() => JSON.parse(sessionStorage.getItem("online-lost-join")));
  assert.ok(lost, "The test must actually drop an initial join response");
  await until(async () => await host.evaluate((id) => {
    const players = window.onlineApp.online.room.players;
    return players.filter((p) => p.connected).length === 1 && players.some((p) => p.id === id && p.connected);
  }, lost.player), "same player recovered after losing first response and reloading");
  const players = await host.evaluate(() => window.onlineApp.online.room.players);
  assert.equal(players.length, 2, "Only the deliberate abandoned entry and the recovered phone exist");
  assert.equal(await phone.evaluate(() => localStorage.getItem(`scorch-player:${new URL(location.href).searchParams.get("join")}`)), lost.token);
  assert.equal(await phone.evaluate(() => localStorage.getItem(`scorch-join:${new URL(location.href).searchParams.get("join")}`)), null);
}

async function canvasContainsColor(locator, color) {
  return locator.evaluate((canvas, rgb) => {
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] === rgb[0] && data[i + 1] === rgb[1] && data[i + 2] === rgb[2] && data[i + 3] === 255) return true;
    }
    return false;
  }, color);
}

export async function checkLobbyRemoval(host, a, b, abandoned, until, out) {
  const before = await host.evaluate(() => window.onlineApp.online.room.players);
  const survivors = before.filter((p) => !abandoned.includes(p.id));
  assert.deepEqual(survivors.map((p) => p.colorIndex), [1, 3]);
  const palette = await host.evaluate(async () => (await import("/src/palette.ts")).TEAM_RGB);
  for (const phone of [a, b]) {
    await phone.getByPlaceholder("Your name").focus();
    await phone.evaluate(() => { window.lobbyNameInput = document.activeElement; });
  }
  const previews = await Promise.all([a, b].map((phone) => phone.locator(".lan-designs canvas").evaluateAll((canvases) => canvases.map((c) => c.toDataURL()))));
  for (const id of abandoned) {
    await host.locator(`.lan-roster [data-player-id="${id}"]`).getByRole("button").click();
    await until(async () => await host.locator(`.lan-roster [data-player-id="${id}"]`).count() === 0 &&
      await a.locator(`.lan-roster [data-player-id="${id}"]`).count() === 0 &&
      await b.locator(`.lan-roster [data-player-id="${id}"]`).count() === 0, "removed player disappears on the host and both phones");
  }
  const after = await host.evaluate(() => window.onlineApp.online.room.players);
  assert.deepEqual(after, survivors, "Removing first/middle players preserves identity, colour, profile and readiness");
  for (const [i, phone] of [a, b].entries()) {
    assert.deepEqual(await phone.locator(".lan-designs canvas").evaluateAll((canvases) => canvases.map((c) => c.toDataURL())), previews[i]);
    assert.ok(await phone.evaluate(() => window.lobbyNameInput.isConnected && document.activeElement === window.lobbyNameInput));
    assert.equal(await phone.getByPlaceholder("Your name").inputValue(), survivors[i].name);
    assert.equal(await phone.getByRole("button", { name: "Not ready", exact: true }).count(), 1);
    for (let design = 0; design < 6; design++) {
      assert.ok(await canvasContainsColor(phone.locator(".lan-designs canvas").nth(design), palette[survivors[i].colorIndex]), "Design preview uses the player's assigned colour");
    }
  }
  for (const p of survivors) {
    const selector = `.lan-roster [data-player-id="${p.id}"] canvas`;
    const expected = await host.locator(selector).evaluate((c) => c.toDataURL());
    for (const phone of [a, b]) assert.equal(await phone.locator(selector).evaluate((c) => c.toDataURL()), expected);
    assert.ok(await canvasContainsColor(host.locator(selector), palette[p.colorIndex]));
  }
  await host.screenshot({ path: `${out}/online-colours-lobby-host.png` });
  await a.screenshot({ path: `${out}/online-colours-lobby-phone.png`, fullPage: true });
  console.log("PASS: lost initial response + reload reuses one player; removing abandoned first/middle entries preserves colours, focus and readiness");
}

export async function checkGameColours(host, phones, until, out, stage) {
  const tanks = await host.evaluate(() => window.onlineApp.gs.tanks.map((t) => ({
    name: t.name, index: t.player_index, slot: t.color_index, paletteIndex: t.color,
  })));
  assert.deepEqual(tanks.map((t) => t.index), [0, 1, 2]);
  assert.deepEqual(tanks.map((t) => t.slot), [1, 3, 0]);
  const palette = await host.evaluate(async () => (await import("/src/palette.ts")).TEAM_RGB);
  if (stage !== "shop") assert.deepEqual(tanks.map((t) => t.paletteIndex), [111, 113, 110]);
  for (const [i, phone] of phones.entries()) {
    const preview = phone.locator(".lan-tank-preview canvas:visible");
    await until(async () => await preview.count() === 1 && await canvasContainsColor(preview, palette[tanks[i].slot]), `${stage}: phone ${i + 1} has its assigned colour`);
    assert.match(await preview.getAttribute("aria-label"), new RegExp(tanks[i].name));
  }
  if (stage === "shop") {
    const name = host.getByText("Alice", { exact: true });
    assert.equal(await name.evaluate((node) => getComputedStyle(node).color), `rgb(${palette[1].join(", ")})`);
  }
  await host.screenshot({ path: `${out}/online-colours-${stage}-host.png` });
  await phones[0].screenshot({ path: `${out}/online-colours-${stage}-phone.png`, fullPage: true });
  console.log(`PASS: ${stage} preserves assigned host/phone colours after lobby removal`);
}
