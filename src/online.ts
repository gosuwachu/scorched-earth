import QRCode from "qrcode";
import type { App } from "./main";
import type { RoomView, ServerMessage } from "../shared/online";
import { canStart } from "../shared/online";
import { Config } from "./config";
import { Renderer } from "./render";
import { Connection } from "./online_connection";
import { RemoteAdapter } from "./remote";
import { button, el, overlay, rosterList } from "./online_ui";
import "./online.css";

const AI_NAMES = ["Moron", "Shooter", "Poolshark", "Tosser", "Chooser", "Spoiler", "Cyborg", "Unknown"];

export class HostSession {
  private connection: Connection;
  private token = "";
  private room?: RoomView;
  private adapter?: RemoteAdapter;
  private box: HTMLElement;
  private bar = el("div", "", "lan-bar");
  private status = el("span", "Creating room…");
  private lastPublish = -Infinity;
  private disposed = false;
  private origin: string;
  private localConfig: Config;
  private shareOpen = false;
  private barSize: ResizeObserver;
  private pending: Extract<ServerMessage, { type: "input" }>[] = [];

  constructor(private app: App, private urls: string[]) {
    this.localConfig = app.cfg;
    const current = new URL(location.href);
    this.origin = urls.includes(current.origin) ? current.origin : urls[0] ?? "";
    this.box = overlay();
    this.box.append(el("h1", "Online lobby"), el("p", "Creating room…"));
    this.bar.append(this.status);
    const share = button("Join link", () => { this.shareOpen = true; this.renderLobby(); });
    const continueButton = button("Continue", () => {
      if (app.onlineScreen === "rankings") app._act("rankings_done");
      else if (app.onlineScreen === "finished") app._act("to_menu");
    });
    continueButton.dataset.lanContinue = "true";
    continueButton.hidden = true;
    this.bar.append(share, continueButton, button("End online game", () => {
      if (window.confirm("End this online game for everyone?")) app._act("to_menu");
    }));
    document.body.append(this.bar);
    document.body.classList.add("lan-host");
    this.barSize = new ResizeObserver(() => {
      document.body.style.setProperty("--lan-bar-height", `${this.bar.offsetHeight}px`);
    });
    this.barSize.observe(this.bar);
    this.connection = new Connection(
      () => this.token && this.room ? { type: "host-resume", room: this.room.id, token: this.token } : { type: "create" },
      (m) => this.receive(m),
      (connected) => {
        if (!connected) { this.adapter?.release(); this.pending = []; }
        this.status.textContent = connected ? "Connected" : "LAN connection lost. Reconnecting…";
      },
    );
  }

  get paused(): boolean { return !this.connection.connected || !this.room?.hostConnected; }
  get keys(): Record<number, boolean> { return this.adapter?.keys(performance.now()) ?? {}; }

  beforeFrame(now: number): void {
    if (!this.room || !this.adapter || this.disposed) return;
    this.adapter.states(this.room.players);
    for (const m of this.pending.splice(0)) this.adapter.receive(m.player, m.context, m.seq, m.input, now);
  }

  afterFrame(now: number): void {
    if (!this.adapter || !this.room || this.disposed) return;
    const states = this.adapter.states(this.room.players);
    const active = Object.values(states).find((s) => s.enabled);
    if (!this.paused) this.status.textContent = active ? `${active.tank?.name}: ${active.screen}` : Object.values(states)[0]?.message ?? "Playing";
    const next = this.bar.querySelector<HTMLButtonElement>("[data-lan-continue]")!;
    next.hidden = this.app.onlineScreen !== "rankings" && this.app.onlineScreen !== "finished";
    next.textContent = this.app.onlineScreen === "finished" ? "Return to menu" : "Continue to purchasing";
    if (now - this.lastPublish >= 100 && !this.paused) {
      this.connection.send({ type: "states", states });
      this.lastPublish = now;
    }
  }

  private receive(m: ServerMessage): void {
    if (this.disposed) return;
    if (m.type === "created") {
      this.token = m.token;
      this.room = m.room;
      this.lastPublish = -Infinity;
      if (!this.adapter) this.renderLobby();
    } else if (m.type === "room") {
      this.room = m.room;
      if (!m.room.started || this.shareOpen) this.renderLobby();
      for (const p of m.room.players) if (!p.connected) this.adapter?.release(p.id);
    } else if (m.type === "started") {
      this.room = m.room;
      this.box.remove();
      if (!this.adapter) {
        this.app.startOnline(m.room.players);
        this.adapter = new RemoteAdapter(this.app, m.room.players);
      }
      this.afterFrame(performance.now());
    } else if (m.type === "release") {
      this.adapter?.release(m.player);
      this.pending = this.pending.filter((input) => input.player !== m.player);
    } else if (m.type === "input") this.pending.push(m);
    else if (m.type === "error") {
      this.status.textContent = m.message;
      if (m.fatal) { this.app._act("to_menu"); showNotice(m.message); }
    } else if (m.type === "ended") {
      this.app._act("to_menu");
    }
  }

  private renderLobby(): void {
    if (!this.room) return;
    if (!this.box.isConnected) { this.box = overlay(); }
    this.box.replaceChildren(el("h1", this.room.started ? "Join / reconnect" : "Online lobby"));
    this.box.append(el("p", "Players watch this screen and use their own devices as controllers. Keep this host page open and visible."));
    const addressLabel = el("label", "LAN address");
    const addresses = el("select");
    for (const url of this.urls) { const o = el("option", url); o.value = url; addresses.append(o); }
    const manual = el("input"); manual.type = "text"; manual.value = this.origin; manual.placeholder = "http://192.168.1.10:3000";
    addresses.value = this.origin;
    addresses.onchange = () => { this.origin = addresses.value; this.renderLobby(); };
    manual.onchange = () => {
      try {
        const url = new URL(manual.value);
        if (!["http:", "https:"].includes(url.protocol) || ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"].includes(url.hostname)) throw new Error();
        this.origin = url.origin; this.renderLobby();
      } catch { manual.setCustomValidity("Enter the host's reachable LAN address, including http:// and the port."); manual.reportValidity(); }
    };
    addressLabel.append(addresses, manual); this.box.append(addressLabel);
    if (this.origin) {
      const url = new URL("/", this.origin); url.searchParams.set("join", this.room.id);
      const link = el("input"); link.type = "text"; link.readOnly = true; link.value = url.href; link.setAttribute("aria-label", "Join link");
      const qr = el("canvas", "", "lan-qr"); qr.setAttribute("aria-label", "Scan to join this game");
      void QRCode.toCanvas(qr, url.href, { width: 220, margin: 2 }).catch(() => { qr.replaceWith(el("p", "Use the join link below.")); });
      this.box.append(qr, link, button("Copy link", () => {
        link.select();
        if (navigator.clipboard) void navigator.clipboard.writeText(url.href).catch(() => { link.focus(); link.select(); });
        else { link.focus(); link.select(); document.execCommand("copy"); }
      }));
    } else this.box.append(el("p", "Enter a LAN address to generate the join link and QR code."));
    this.box.append(el("h2", "Players"), rosterList(this.room.players, this.room.started ? undefined :
      (p) => this.connection.send({ type: "remove", player: p.id })));
    if (!this.room.started) {
      const ai = el("select"); ai.setAttribute("aria-label", "Computer difficulty");
      AI_NAMES.forEach((name, i) => { const o = el("option", name); o.value = String(i + 1); o.selected = i === 5; ai.append(o); });
      const design = el("select"); design.setAttribute("aria-label", "Computer tank design");
      for (let i = 0; i < 7; i++) { const o = el("option", `Tank ${i + 1}`); o.value = String(i); o.selected = i === 3; design.append(o); }
      this.box.append(ai, design, button("Add computer", () => this.connection.send({
        type: "add-ai", ai: Number(ai.value), name: AI_NAMES[Number(ai.value) - 1].slice(0, 8), icon: Number(design.value),
      })));
      const start = button("Start online game", () => this.connection.send({ type: "start" }));
      start.disabled = !canStart(this.room.players) || this.paused;
      this.box.append(el("p", "2–10 tanks; at least one human. Every human must be connected and ready."), start,
        button("Cancel", () => this.app._act("to_menu")));
    } else this.box.append(button("Close join link", () => { this.shareOpen = false; this.box.remove(); }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.connection.send({ type: "end" });
    this.connection.close();
    this.adapter?.release();
    this.box.remove(); this.bar.remove();
    this.barSize.disconnect();
    document.body.classList.remove("lan-host");
    document.body.style.removeProperty("--lan-bar-height");
    this.app.cfg = this.localConfig;
    this.app.renderer = new Renderer(this.localConfig, this.app.w, this.app.h);
  }
}

function showNotice(message: string): void {
  const box = overlay();
  box.append(el("h1", "LAN play"), el("p", message), button("Close", () => box.remove()));
}

export function installOnline(app: App): void {
  app.chooseMode = () => {
    const box = overlay();
    box.append(el("h1", "New game"), el("p", "Choose how to play."));
    box.append(button("Local", () => { box.remove(); app.startLocal(); }));
    box.append(button("Online", () => {
      const info = el("p", "Connecting to the LAN service…"); box.append(info);
      for (const b of box.querySelectorAll("button")) b.disabled = true;
      void fetch("/api/lan", { signal: AbortSignal.timeout(5000) }).then(async (response) => {
        if (!response.ok) throw new Error();
        const data = await response.json() as { urls?: string[] };
        if (!Array.isArray(data.urls)) throw new Error();
        box.remove(); app.online = new HostSession(app, data.urls);
      }).catch(() => {
        info.textContent = "Start the LAN service with npm run lan (or npm run dev:lan), then open the host URL printed in the terminal. Local play remains available here.";
        for (const b of box.querySelectorAll("button")) b.disabled = false;
      });
    }));
    box.append(button("Back", () => box.remove()));
  };
}
