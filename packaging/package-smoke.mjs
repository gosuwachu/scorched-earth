import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { once } from "node:events";

const app = "/opt/scorchedearth-html5";
const { WebSocket } = createRequire(`${app}/package.json`)("ws");
const settings = Object.fromEntries((await readFile("/etc/default/scorchedearth-html5", "utf8"))
  .split("\n").filter((line) => /^[A-Z_]+=/.test(line)).map((line) => line.split("=")));
const base = `http://${settings.HOST}:${settings.PORT}`;
const unit = await readFile("/usr/lib/systemd/system/scorchedearth-html5.service", "utf8");
const restrictions = [...unit.matchAll(/^RestrictAddressFamilies=(.+)$/gm)];
assert.equal(restrictions.length, 1, "Expected one explicit family allowlist");
const families = restrictions[0][1].trim().split(/\s+/);
assert.ok(families.includes("AF_NETLINK"), "Packaged service must allow interface discovery");
const denyNetlink = process.env.TEST_DENY_NETLINK === "1";
const launcher = ["runuser", "-u", "scorchedearth-html5", "--", "/tests/restrict-address-families",
  ...families.filter((family) => !denyNetlink || family !== "AF_NETLINK"), "--", `${app}/node/bin/node`];
// Probe independently: fallback must not hide a broken allowlist/filter.
const probe = spawnSync(launcher[0], [...launcher.slice(1), "--input-type=module", "-e",
  'import { networkInterfaces } from "node:os"; networkInterfaces();'], { encoding: "utf8" });
assert.equal(probe.status, denyNetlink ? 1 : 0, probe.stderr);
if (denyNetlink) assert.match(probe.stderr, /uv_interface_addresses.*97/);
function launch(overrides = {}) {
  return spawn(launcher[0], [...launcher.slice(1), "dist-server/server/index.js"], {
    cwd: app, env: { ...process.env, ...settings, ...overrides }, stdio: ["ignore", "pipe", "pipe"],
  });
}
const server = launch();
let log = "";
server.stdout.on("data", (b) => { log += b; });
server.stderr.on("data", (b) => { log += b; });
const peers = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function request(socket, message, type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off("message", receive); reject(new Error(`Missing ${type}`)); }, 5000);
    function receive(data) {
      const result = JSON.parse(String(data));
      if (result.type === type) { clearTimeout(timer); socket.off("message", receive); resolve(result); }
    }
    socket.on("message", receive);
    socket.send(JSON.stringify(message));
  });
}
async function peer() {
  const socket = new WebSocket(`${base.replace("http:", "ws:")}/online`);
  peers.push(socket);
  await once(socket, "open");
  return socket;
}
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { ready = (await fetch(`${base}/api/lan`)).ok; } catch { /* starting */ }
    if (ready || server.exitCode !== null) break;
    await pause(50);
  }
  assert.ok(ready, log);
  const lan = await (await fetch(`${base}/api/lan`)).json();
  assert.ok(Array.isArray(lan.urls));
  if (denyNetlink) {
    assert.deepEqual(lan.urls, []);
    assert.equal(log.split("LAN interface discovery failed").length - 1, 1, log);
  } else {
    assert.doesNotMatch(log, /LAN interface discovery failed/);
  }
  const html = await (await fetch(base)).text();
  assert.match(html, /id="game"/);
  const js = html.match(/src="([^"]+\.js)"/)[1];
  assert.equal((await fetch(new URL(js, base))).status, 200);
  assert.equal((await fetch(`${base}/assets/TALK1.CFG`)).status, 200);
  assert.equal((await fetch(`${base}/missing-file`)).status, 404);
  const host = await peer();
  const created = await request(host, { type: "create" }, "created");
  const player = await peer();
  const joined = await request(player, { type: "join", room: created.room.id }, "joined");
  assert.ok(joined.token);
  player.close();
  await once(player, "close");
  const reconnected = await peer();
  const resumed = await request(reconnected, { type: "join", room: created.room.id, token: joined.token }, "joined");
  assert.equal(resumed.token, joined.token);
  for (const overrides of [{ PORT: "nope" }, { PORT: "0" }, { HOST: "https://example.com" }, {}]) {
    const child = launch(overrides);
    let errors = "";
    child.stderr.on("data", (b) => { errors += b; });
    const [code] = await once(child, "exit");
    assert.equal(code, 1);
    assert.match(errors, Object.keys(overrides).length ? /Invalid server configuration/ : /address already in use/);
  }
} finally {
  for (const socket of peers) socket.terminate();
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    const timer = setTimeout(() => server.kill("SIGKILL"), 5000);
    const [code, signal] = await once(server, "exit");
    clearTimeout(timer);
    assert.notEqual(signal, "SIGKILL", "Server must stop promptly");
  }
}
console.log(`PASS: installed assets, unprivileged multiplayer/reconnect, invalid settings, port conflict, shutdown; netlink ${denyNetlink ? "denied (fallback)" : "allowed"}`);
