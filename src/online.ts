import QRCode from "qrcode";
import type { App } from "./main";
import type { RoomView, ServerMessage } from "../shared/online";
import { canStart } from "../shared/online";
import { Config } from "./config";
import { Renderer } from "./render";
import { Connection } from "./online_connection";
import { joinOrigin } from "./online_address";
import { RemoteAdapter } from "./remote";
import { sfx } from "./sound";
import { button, el, dialog, installOnlineTheme, Roster, type OnlineDialog } from "./online_ui";
import "./online.css";

const AI_NAMES = ["Moron", "Shooter", "Poolshark", "Tosser", "Chooser", "Spoiler", "Cyborg", "Unknown"];

export class HostSession {
  private connection: Connection;
  private token = "";
  private room?: RoomView;
  private adapter?: RemoteAdapter;
  private box: OnlineDialog;
  private roster?: Roster;
  private lobbyStarted?: boolean;
  private startButton?: HTMLButtonElement;
  private addButton?: HTMLButtonElement;
  private confirmation?: OnlineDialog;
  private bar = el("div", "", "lan-bar");
  private status = el("span", "Creating room…");
  private lastPublish = -Infinity;
  private disposed = false;
  private readonly origin: string;
  private localConfig: Config;
  private shareOpen = false;
  private barSize: ResizeObserver;
  private pending: Extract<ServerMessage, { type: "input" }>[] = [];

  constructor(private app: App, urls: string[]) {
    this.localConfig = app.cfg;
    this.origin = joinOrigin(location.href, urls);
    this.box = dialog("Online lobby", { wide: true, cancel: () => app._act("to_menu") });
    this.box.body.append(el("p", "Creating room…"));
    this.bar.append(this.status);
    const share = button("Join link", () => { this.shareOpen = true; this.renderLobby(); });
    const continueButton = button("Continue", () => {
      if (app.onlineScreen === "rankings") app._act("rankings_done");
      else if (app.onlineScreen === "finished") app._act("to_menu");
    });
    continueButton.dataset.lanContinue = "true";
    continueButton.hidden = true;
    this.bar.append(share, continueButton, button("End online game", () => this.confirmEnd()));
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
        this.updateLobbyState();
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
      this.box.close();
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

  private updateLobbyState(): void {
    if (!this.room) return;
    this.roster?.update(this.room.players);
    if (this.startButton) this.startButton.disabled = !canStart(this.room.players) || this.paused;
    if (this.addButton) this.addButton.disabled = this.room.players.length >= 10 || this.paused;
  }

  private confirmEnd(): void {
    if (this.confirmation) return;
    const cancel = (): void => { this.confirmation?.close(); this.confirmation = undefined; };
    this.confirmation = dialog("End online game", { cancel });
    this.confirmation.body.append(el("p", "End this online game for everyone?"));
    this.confirmation.footer.append(
      button("Cancel", cancel),
      button("End game", () => { cancel(); this.app._act("to_menu"); }),
    );
  }

  private renderLobby(): void {
    if (!this.room) return;
    const close = (): void => {
      if (this.room?.started) { this.shareOpen = false; this.box.close(); }
      else this.app._act("to_menu");
    };
    if (!this.box.element.isConnected) {
      this.box = dialog(this.room.started ? "Join / reconnect" : "Online lobby", { wide: true, cancel: close });
      this.roster = undefined;
    }
    // Presence updates only touch the roster and button availability. Preserve
    // the host's AI choices, keyboard focus, and scroll position.
    if (this.roster && this.lobbyStarted === this.room.started) {
      this.updateLobbyState();
      return;
    }
    this.lobbyStarted = this.room.started;
    this.startButton = undefined;
    this.addButton = undefined;
    this.box.body.replaceChildren(el("p", "Players watch this screen and use their own devices as controllers. Keep this host page open and visible."));
    this.box.footer.replaceChildren();
    const layout = el("div", "", "lan-lobby-layout");
    const sharing = el("section");
    const players = el("section");
    layout.append(sharing, players);
    this.box.body.append(layout);

    const qr = el("canvas", "", "lan-qr");
    qr.setAttribute("aria-label", "Scan to join this game");
    const qrMessage = el("p");
    const link = el("input");
    link.type = "text"; link.readOnly = true; link.setAttribute("aria-label", "Join link");
    const linkRow = el("div", "", "lan-link");
    const copy = button("Copy link", () => {
      link.select();
      if (navigator.clipboard) void navigator.clipboard.writeText(link.value).catch(() => { link.focus(); link.select(); });
      else { link.focus(); link.select(); document.execCommand("copy"); }
    });
    linkRow.append(link, copy);
    qr.hidden = !this.origin;
    linkRow.hidden = !this.origin;
    qrMessage.textContent = this.origin ? "" : "No reachable join address found. Open this game using its public or LAN URL.";
    if (this.origin) {
      const url = new URL("/", this.origin);
      url.searchParams.set("join", this.room.id);
      link.value = url.href;
      void QRCode.toCanvas(qr, url.href, { width: 220, margin: 2 }).catch(() => {
        qr.hidden = true;
        qrMessage.textContent = "Use the join link below.";
      });
    }
    sharing.append(qr, qrMessage, linkRow);

    this.roster = new Roster(this.room.started ? undefined : (id) => this.connection.send({ type: "remove", player: id }));
    players.append(el("h2", "Players"), this.roster.element);
    if (!this.room.started) {
      const aiLabel = el("label", "Computer difficulty");
      const ai = el("select");
      ai.setAttribute("aria-label", "Computer difficulty");
      AI_NAMES.forEach((name, i) => { const option = el("option", name); option.value = String(i + 1); option.selected = i === 5; ai.append(option); });
      const designLabel = el("label", "Computer tank design");
      const design = el("select");
      design.setAttribute("aria-label", "Computer tank design");
      for (let i = 0; i < 7; i++) { const option = el("option", `Tank ${i + 1}`); option.value = String(i); option.selected = i === 3; design.append(option); }
      aiLabel.append(ai); designLabel.append(design);
      this.addButton = button("Add computer", () => this.connection.send({
        type: "add-ai", ai: Number(ai.value), name: AI_NAMES[Number(ai.value) - 1].slice(0, 8), icon: Number(design.value),
      }));
      players.append(aiLabel, designLabel, this.addButton);
      this.startButton = button("Start online game", () => {
        sfx.unlock();
        this.connection.send({ type: "start" });
      });
      players.append(el("p", "2–10 tanks; at least one human. Every human must be connected and ready."));
      this.box.footer.append(this.startButton, button("Cancel", close));
    } else this.box.footer.append(button("Close join link", close));
    this.updateLobbyState();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.connection.send({ type: "end" });
    this.connection.close();
    this.adapter?.release();
    this.confirmation?.close();
    this.box.close(); this.bar.remove();
    this.barSize.disconnect();
    document.body.classList.remove("lan-host");
    document.body.style.removeProperty("--lan-bar-height");
    this.app.cfg = this.localConfig;
    this.app.renderer = new Renderer(this.localConfig, this.app.w, this.app.h);
  }
}

function showNotice(message: string): void {
  const box = dialog("LAN play", { cancel: () => box.close() });
  box.body.append(el("p", message));
  box.footer.append(button("Close", () => box.close()));
}

export function installOnline(app: App): void {
  installOnlineTheme();
  app.chooseMode = () => {
    let pending = false;
    const box = dialog("New game", { cancel: () => { if (!pending) box.close(); } });
    box.body.append(el("p", "Choose how to play."));
    const local = button("Local", () => { box.close(); app.startLocal(); }, "l");
    const back = button("Back", () => box.close(), "b");
    const info = el("p");
    info.setAttribute("role", "status");
    const online = button("Online", () => {
      pending = true;
      info.textContent = "Connecting to the LAN service…";
      for (const b of box.footer.querySelectorAll("button")) b.disabled = true;
      void fetch("/api/lan", { signal: AbortSignal.timeout(5000) }).then(async (response) => {
        if (!response.ok) throw new Error();
        const data = await response.json() as { urls?: string[] };
        if (!Array.isArray(data.urls)) throw new Error();
        box.close(); app.online = new HostSession(app, data.urls);
      }).catch(() => {
        pending = false;
        info.textContent = "Start the LAN service with npm run lan (or npm run dev:lan), then open the host URL printed in the terminal. Local play remains available here.";
        for (const b of box.footer.querySelectorAll("button")) b.disabled = false;
        online.focus();
      });
    }, "o");
    box.body.append(info);
    box.footer.append(local, online, back);
    box.element.addEventListener("keydown", (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      const action = { l: local, o: online, b: back }[event.key.toLowerCase()];
      if (action) { event.preventDefault(); action.click(); }
    });
    local.focus();
  };
}
