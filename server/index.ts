import { createServer } from "node:http";
import { isIP } from "node:net";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { Rooms, type Peer } from "./rooms.js";
import { discoverLanUrls } from "./lan.js";

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST ?? "0.0.0.0";
if (!Number.isInteger(port) || port < 1 || port > 65535 || !isIP(host)) {
  console.error("Invalid server configuration: HOST must be an IP address and PORT an integer from 1 to 65535.");
  process.exit(1);
}
const dev = process.argv.includes("--dev");
const root = resolve("dist");
const registry = new Rooms();
const urls = discoverLanUrls(port);
const mime: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon",
};
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url || "/", "http://localhost").pathname;
    if (path === "/api/lan") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ urls }));
      return;
    }
    if (vite) { vite.middlewares(req, res); return; }
    const file = resolve(root, "." + decodeURIComponent(path === "/" ? "/index.html" : path));
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) { res.writeHead(404); res.end(); return; }
    res.setHeader("Content-Type", mime[extname(file)] || "application/octet-stream");
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end("Not found"); }
});
// Use the installed Vite's middleware API only in development.
const vite = dev ? await (await import("vite")).createServer({
  server: { middlewareMode: true, hmr: { server } }, appType: "spa",
}) : null;
const wss = new WebSocketServer({ noServer: true, maxPayload: 512 * 1024 });
server.on("upgrade", (req, socket, head) => {
  if (req.url === "/online") wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
  else if (!dev) socket.destroy();
});
wss.on("connection", (ws) => {
  let alive = true;
  const peer: Peer = {
    send: (m) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m)); },
    close: () => ws.close(),
  };
  const heartbeat = setInterval(() => {
    if (!alive) { ws.terminate(); return; }
    alive = false; ws.ping();
  }, 10_000);
  ws.on("pong", () => { alive = true; });
  ws.on("message", (bytes) => {
    try { registry.receive(peer, JSON.parse(bytes.toString())); }
    catch { peer.send({ type: "error", message: "Invalid message." }); }
  });
  ws.on("error", () => ws.terminate());
  ws.on("close", () => { clearInterval(heartbeat); registry.disconnect(peer); });
});
const cleanup = setInterval(() => registry.expire(), 30_000);
server.on("error", (error: NodeJS.ErrnoException) => {
  console.error(`Cannot listen on ${host}:${port}: ${error.code === "EADDRINUSE" ? "address already in use" : error.message}`);
  process.exit(1);
});
server.listen(port, host, () => {
  console.log(`Scorched Earth listening on ${host}:${port}`);
  if (host === "0.0.0.0" || host === "::") {
    for (const url of urls) console.log(`  Join from your LAN: ${url}`);
  }
});
async function shutdown(): Promise<void> {
  clearInterval(cleanup);
  for (const ws of wss.clients) ws.terminate();
  wss.close();
  await vite?.close();
  server.close();
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
