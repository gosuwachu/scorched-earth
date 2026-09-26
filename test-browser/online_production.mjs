// Smoke-test the shipped entrypoint and built server, with no game-state harness.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { WebSocket } from "ws";

const root = fileURLToPath(new URL("../", import.meta.url));
const server = spawn(process.execPath, ["dist-server/server/index.js"], {
  cwd: root, env: { ...process.env, PORT: "4318" }, stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
server.stdout.on("data", (b) => { log += b; });
server.stderr.on("data", (b) => { log += b; });
let browser;
let phone;
const peers = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await pause(50);
  }
  throw new Error(`Timed out: ${label}`);
}
async function joinPeer(url, room, token) {
  const socket = new WebSocket(url);
  peers.push(socket);
  const joined = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Player join timed out")), 5000);
    socket.on("open", () => socket.send(JSON.stringify({ type: "join", room, token })));
    socket.on("error", reject);
    socket.on("message", (data) => {
      const message = JSON.parse(String(data));
      if (message.type === "joined") { clearTimeout(timer); resolve(message); }
    });
  });
  return { socket, ...joined };
}
try {
  const base = "http://127.0.0.1:4318";
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { up = (await fetch(`${base}/api/lan`)).ok; } catch { /* starting */ }
    if (!up) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(up, `Production server did not start: ${log}`);
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || ["/usr/bin/chromium", "/usr/bin/google-chrome"].find(existsSync),
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  const errors = [];
  const hostContext = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await hostContext.addInitScript(() => localStorage.setItem("scorch.cfg", "INITIAL_CASH=100000\nPLAY_ORDER=ROUND-ROBIN\nHOSTILE_ENVIRONMENT=OFF\nSOUND=OFF\n"));
  const host = await hostContext.newPage();
  host.on("pageerror", (e) => errors.push(String(e)));
  await host.goto(base);
  await host.locator("#loading.done").waitFor({ state: "attached" });
  await host.keyboard.press("Enter");
  const mode = host.getByRole("dialog", { name: "New game", exact: true });
  const dimensions = await mode.boundingBox();
  assert.ok(dimensions.width <= 422 && dimensions.height < 240, "Mode chooser must be compact");
  assert.equal(await mode.evaluate((d) => getComputedStyle(d).backgroundColor), "rgb(170, 170, 170)");
  assert.equal(await mode.locator(".lan-title").evaluate((d) => getComputedStyle(d).backgroundColor), "rgb(0, 0, 160)");
  assert.equal(await host.evaluate(() => document.activeElement.textContent), "Local");
  await host.keyboard.press("Shift+Tab");
  assert.equal(await host.evaluate(() => document.activeElement.textContent), "Back");
  await host.keyboard.press("Escape");
  await mode.waitFor({ state: "detached" });
  await host.keyboard.press("Enter");
  mkdirSync(`${root}/test-browser/out`, { recursive: true });
  await host.screenshot({ path: `${root}/test-browser/out/online-mode.png` });
  await host.keyboard.press("o");
  const link = host.getByRole("textbox", { name: "Join link", exact: true });
  await link.waitFor();
  const join = await link.inputValue();
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  phone = await phoneContext.newPage();
  phone.on("pageerror", (e) => errors.push(String(e)));
  // Use the actual generated LAN address, not a rewritten localhost URL.
  await phone.goto(join);
  await phone.getByPlaceholder("Your name").fill("Player1");
  await phone.getByRole("button", { name: "Ready", exact: true }).click();
  await host.getByRole("button", { name: "Add computer", exact: true }).click();
  const room = new URL(join).searchParams.get("join");
  const wsUrl = `${base.replace("http:", "ws:")}/online`;
  const guestPeers = [];
  for (let i = 0; i < 8; i++) {
    const peer = await joinPeer(wsUrl, room);
    peer.socket.send(JSON.stringify({ type: "profile", name: `Guest${i + 1}`, icon: i % 6, ready: true }));
    guestPeers.push(peer);
  }
  await until(async () => await phone.locator(".lan-roster li").count() === 10, "ten players");
  const guestRoster = phone.getByRole("region", { name: "Connected players", exact: true });
  const hostRoster = host.getByRole("region", { name: "Connected players", exact: true });
  assert.ok(await guestRoster.evaluate((r) => r.scrollHeight > r.clientHeight), "Guest roster has its own scroll area");
  await guestRoster.scrollIntoViewIfNeeded();
  await guestRoster.focus();
  await phone.keyboard.press("End");
  await until(async () => await guestRoster.evaluate((r) => r.scrollTop + r.clientHeight >= r.scrollHeight - 2), "keyboard roster scrolling");
  await pause(200);
  await guestRoster.evaluate((r) => { r.scrollTop = 0; });
  await guestRoster.hover();
  await phone.mouse.wheel(0, 1600);
  await until(async () => await guestRoster.evaluate((r) => r.scrollTop + r.clientHeight >= r.scrollHeight - 2), "wheel reaches final player");
  const guestScroll = await guestRoster.evaluate((r) => r.scrollTop);
  await hostRoster.evaluate((r) => { r.scrollTop = r.scrollHeight; });
  const hostScroll = await hostRoster.evaluate((r) => r.scrollTop);
  await host.getByLabel("Computer difficulty", { exact: true }).selectOption("2");
  await host.getByLabel("Computer tank design", { exact: true }).selectOption("5");
  const manual = host.getByLabel("Custom LAN address", { exact: true });
  const originalAddress = await manual.inputValue();
  await manual.fill("http://unfinished-address");
  await phone.evaluate(() => {
    window.rosterBefore = document.querySelector(".lan-roster-scroll");
    window.lastRowBefore = document.querySelector(".lan-roster li:last-child");
  });
  guestPeers[0].socket.send(JSON.stringify({ type: "profile", name: "Guest1", icon: 0, ready: false }));
  await until(async () => (await guestRoster.innerText()).includes("Choosing tank"), "readiness update");
  assert.equal(await guestRoster.evaluate((r) => r.scrollTop), guestScroll);
  assert.equal(await hostRoster.evaluate((r) => r.scrollTop), hostScroll);
  assert.ok(await phone.evaluate(() => window.rosterBefore === document.querySelector(".lan-roster-scroll") && window.lastRowBefore === document.querySelector(".lan-roster li:last-child")));
  assert.equal(await manual.inputValue(), "http://unfinished-address");
  assert.ok(await manual.evaluate((n) => document.activeElement === n));
  assert.equal(await host.getByLabel("Computer difficulty", { exact: true }).inputValue(), "2");
  assert.equal(await host.getByLabel("Computer tank design", { exact: true }).inputValue(), "5");
  await manual.fill(originalAddress);
  await manual.press("Tab");
  guestPeers[0].socket.close();
  await until(async () => (await guestRoster.innerText()).includes("Disconnected"), "disconnected roster row");
  assert.equal(await guestRoster.evaluate((r) => r.scrollTop), guestScroll);
  const rejoined = await joinPeer(wsUrl, room, guestPeers[0].token);
  rejoined.socket.send(JSON.stringify({ type: "profile", name: "Guest1", icon: 0, ready: true }));
  await until(async () => !(await guestRoster.innerText()).includes("Disconnected"), "reconnected roster row");
  assert.equal(await guestRoster.evaluate((r) => r.scrollTop), guestScroll);

  // Real touch gestures, not programmatic scrollTop, exercise mobile scrolling.
  const cdp = await phoneContext.newCDPSession(phone);
  await guestRoster.evaluate((r) => { r.scrollTop = 0; });
  const rosterBox = await guestRoster.boundingBox();
  const x = rosterBox.x + rosterBox.width / 2;
  const y = rosterBox.y + rosterBox.height - 15;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let n = 1; n <= 5; n++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - n * 24 }] });
    await pause(25);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await until(async () => await guestRoster.evaluate((r) => r.scrollTop) > 40, "touch roster scrolling");
  await cdp.detach();
  await pause(500);
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await phone.setViewportSize(viewport);
    await pause(100);
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "No horizontal overflow");
    await phone.evaluate(() => window.scrollTo(0, 0));
    await phone.mouse.move(viewport.width / 2, 40);
    await phone.mouse.wheel(0, 2000);
    if (await phone.evaluate(() => document.documentElement.scrollHeight > innerHeight)) {
      await until(async () => await phone.evaluate(() => window.scrollY) > 0, `guest page scrolls at ${viewport.width}x${viewport.height}`);
    }
    await phone.getByRole("button", { name: "Not ready", exact: true }).scrollIntoViewIfNeeded();
    await phone.screenshot({ path: `${root}/test-browser/out/online-guest-${viewport.width}x${viewport.height}.png`, fullPage: true });
  }
  await phone.setViewportSize({ width: 390, height: 844 });
  for (const viewport of [{ width: 1024, height: 768 }, { width: 320, height: 568 }, { width: 1200, height: 900 }]) {
    await host.setViewportSize(viewport);
    const footer = await host.locator(".lan-dialog-footer").boundingBox();
    assert.ok(footer.y >= 0 && footer.y + footer.height <= viewport.height, "Dialog actions remain in the viewport");
  }
  await host.screenshot({ path: `${root}/test-browser/out/online-lobby.png` });
  for (let i = 0; i < 8; i++) await host.getByRole("button", { name: `Remove Guest${i + 1}`, exact: true }).click();
  await until(async () => await phone.locator(".lan-roster li").count() === 2, "temporary participants removed");
  await host.getByRole("button", { name: "Start online game", exact: true }).click();
  await phone.getByRole("button", { name: "Done", exact: true }).click();
  await phone.getByRole("button", { name: "Tank controls", exact: true }).waitFor();
  const before = await phone.locator(".lan-stats").textContent();
  await phone.getByRole("button", { name: "← Angle", exact: true }).tap();
  await phone.waitForFunction((before) => document.querySelector(".lan-stats").textContent !== before, before);
  await phone.reload();
  await phone.getByRole("button", { name: "Tank controls", exact: true }).waitFor();
  await host.screenshot({ path: `${root}/test-browser/out/online-production-host.png` });
  const canvas = await host.locator("#game").boundingBox();
  const bar = await host.locator(".lan-bar").boundingBox();
  assert.ok(canvas.y + canvas.height <= bar.y + 1, "The host toolbar must not cover the battlefield");
  await host.getByRole("button", { name: "End online game", exact: true }).click();
  await host.getByRole("dialog", { name: "End online game", exact: true }).waitFor();
  await host.keyboard.press("Escape");
  await host.getByRole("dialog", { name: "End online game", exact: true }).waitFor({ state: "detached" });
  assert.deepEqual(errors, []);
  console.log("PASS: production LAN flow; game-style dialogs; focus/shortcuts; ten-player keyboard, wheel and touch scrolling; stable roster updates; responsive layouts; touch control and refresh recovery");
} catch (error) {
  if (phone) {
    console.error(await phone.evaluate(() => ({ width: innerWidth, height: innerHeight, scroll: scrollY, rootHeight: document.documentElement.scrollHeight, bodyHeight: document.body.scrollHeight, bodyScroll: document.body.scrollTop, roster: (() => { const r = document.querySelector(".lan-roster-scroll"); return r && { top: r.scrollTop, height: r.clientHeight, total: r.scrollHeight, box: r.getBoundingClientRect().toJSON() }; })() })));
    await phone.screenshot({ path: `${root}/test-browser/out/online-failure.png`, fullPage: true });
  }
  console.error(error, log);
  process.exitCode = 1;
} finally {
  for (const peer of peers) peer.close();
  await browser?.close();
  server.kill("SIGTERM");
  await new Promise((resolve) => {
    if (server.exitCode !== null) return resolve();
    server.once("exit", resolve);
    setTimeout(() => { server.kill("SIGKILL"); resolve(); }, 3000).unref();
  });
}
