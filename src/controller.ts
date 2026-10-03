import type { ControllerView, Input, RoomView, ServerMessage, Control } from "../shared/online";
import { REMOTE_KEYS } from "../shared/online";
import { Connection } from "./online_connection";
import { button, el, installOnlineTheme, Roster, tankIcon } from "./online_ui";
import { get_sprite, WEAPON_ICON_BASE, weapon_icon_palette } from "./sprites";
import { hudAngle } from "./angles";
import "./online.css";

interface ControlNode {
  node: HTMLElement;
  field?: HTMLInputElement | HTMLSelectElement;
  button?: HTMLButtonElement;
  label?: HTMLElement;
  kind: Control["kind"];
  options?: string;
  purchase?: { slot: number; marker: HTMLElement; owned: HTMLElement; name: HTMLElement; price: HTMLElement };
}

export function startController(roomId: string): void {
  installOnlineTheme();
  document.getElementById("game")?.remove();
  document.getElementById("loading")?.remove();
  document.body.classList.add("lan-phone");
  document.documentElement.classList.add("lan-phone");
  const root = el("main", "", "lan-controller se-ui");
  const status = el("p", "Connecting…", "lan-status");
  const error = el("p", "", "lan-error");
  const content = el("div");
  const body = el("div", "", "lan-controller-body");
  body.append(status, error, content);
  root.append(el("h1", "Scorched Earth", "ui-title"), body);
  document.body.append(root);
  const storageKey = `scorch-player:${roomId}`;
  let token: string | undefined;
  try { token = localStorage.getItem(storageKey) || undefined; }
  catch { error.textContent = "Browser storage is unavailable. Keep this page open to retain your player."; }
  let playerId = "";
  let room: RoomView | undefined;
  let view: ControllerView | undefined;
  let seq = 0;
  let ended = false;
  let gameBuilt = false;
  let lobbyBuilt = false;
  let icon = 3;
  let ready = false;
  const held = new Set<string>();
  const heldButtons = new Map<string, HTMLButtonElement>();
  let name: HTMLInputElement;
  let readyButton: HTMLButtonElement;
  let roster: Roster;
  let stats: HTMLElement;
  let heading: HTMLElement;
  let controls: HTMLElement;
  const controlNodes = new Map<string, ControlNode>();

  const allowed = (): boolean => !ended && !!connection.connected && !!room?.hostConnected && !!view?.enabled;
  const send = (input: Input): void => {
    if (allowed()) connection.send({ type: "input", context: view!.context, seq: ++seq, input });
  };
  const release = (): void => {
    if (held.size) send({ kind: "hold", keys: [] });
    held.clear();
    for (const b of heldButtons.values()) b.dataset.held = "false";
  };
  const key = (code: string, down: boolean): void => {
    if (!allowed() || (view?.keys && !view.keys.includes(code)) ||
        (view?.targeting && code !== "Escape" && !code.startsWith("Digit")) || (down && held.has(code))) return;
    if (down) held.add(code); else held.delete(code);
    send({ kind: "key", key: code, down });
    const b = heldButtons.get(code);
    if (b) b.dataset.held = String(down);
  };

  function updateStatus(): void {
    if (ended) return;
    status.textContent = !connection.connected ? "Connection lost. Reconnecting…" : !room?.hostConnected ?
      "Host unavailable. Waiting for the original host page to reconnect…" : view?.message ?? "Choose your tank and get ready.";
    for (const [code, b] of heldButtons) b.disabled = !allowed() || (!!view?.keys && !view.keys.includes(code)) ||
      (!!view?.targeting && code !== "Escape");
    const invalidTarget = ["target-0", "target-1"].some((id) => {
      const field = controlNodes.get(id)?.field;
      return field instanceof HTMLInputElement && (!field.value || !field.validity.valid);
    });
    for (const [id, record] of controlNodes) {
      const c = view?.controls.find((c) => c.id === id);
      if (record.field) record.field.disabled = !allowed() || !!c?.disabled;
      if (record.button) record.button.disabled = !allowed() || !!c?.disabled || (id === "target-fire" && invalidTarget);
    }
    if (readyButton) readyButton.disabled = !connection.connected || !room?.hostConnected;
  }

  function lobby(): void {
    if (!room) return;
    const me = room.players.find((p) => p.id === playerId);
    if (!lobbyBuilt) {
      lobbyBuilt = true;
      content.replaceChildren(el("h2", "Join the battle"));
      name = el("input"); name.type = "text"; name.maxLength = 8; name.value = me?.name === "Player" ? "" : me?.name ?? "";
      name.placeholder = "Your name"; name.setAttribute("autocomplete", "nickname");
      const label = el("label", "Name (up to 8 characters)"); label.append(name);
      icon = me?.icon ?? 3;
      const designs = el("div", "", "lan-designs");
      const buttons: HTMLButtonElement[] = [];
      for (let i = 0; i < 6; i++) {
        const b = button("", () => {
          icon = i; ready = false;
          buttons.forEach((b, n) => b.setAttribute("aria-pressed", String(n === icon)));
          readyButton.textContent = "Ready";
          if (name.value.trim()) connection.send({ type: "profile", name: name.value.trim(), icon, ready: false });
        });
        b.setAttribute("aria-label", `Choose tank ${i + 1}`);
        b.setAttribute("aria-pressed", String(i === icon));
        b.append(tankIcon(i, room.players.findIndex((p) => p.id === playerId)));
        buttons.push(b); designs.append(b);
      }
      ready = me?.ready ?? false;
      readyButton = button(ready ? "Not ready" : "Ready", () => {
        if (!name.value.trim()) { error.textContent = "Enter your name first."; name.focus(); return; }
        error.textContent = "";
        ready = !ready;
        connection.send({ type: "profile", name: name.value.trim(), icon, ready });
        readyButton.textContent = ready ? "Not ready" : "Ready";
      });
      name.oninput = () => {
        if (ready) {
          ready = false; readyButton.textContent = "Ready";
          connection.send({ type: "profile", name: me?.name ?? "Player", icon, ready: false });
        }
      };
      roster = new Roster();
      content.append(label, el("h2", "Choose your tank"), designs, readyButton, el("h2", "Players"), roster.element);
    }
    roster.update(room.players);
  }

  function buildGame(): void {
    if (gameBuilt) return;
    gameBuilt = true;
    content.replaceChildren();
    heading = el("h2"); stats = el("div", "", "lan-stats");
    const keys = el("div", "", "lan-keys");
    for (const [label, code] of [
      ["← Angle", "ArrowLeft"], ["↑ Power", "ArrowUp"], ["Angle →", "ArrowRight"],
      ["Previous weapon", "BracketLeft"], ["↓ Power", "ArrowDown"], ["Tab / Next", "Tab"],
      ["Space / Fire", "Space"], ["Enter", "Enter"], ["Back / Esc", "Escape"],
    ]) {
      const b = button(label, () => {});
      b.onpointerdown = (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); key(code, true); };
      b.onpointerup = (e) => { e.preventDefault(); key(code, false); };
      b.onpointercancel = () => { key(code, false); };
      b.onlostpointercapture = () => { if (held.has(code)) key(code, false); };
      // Keyboard/screen-reader activation emits a complete tap.
      b.onclick = (e) => { if (e.detail === 0) { key(code, true); key(code, false); } };
      b.oncontextmenu = (e) => e.preventDefault();
      heldButtons.set(code, b); keys.append(b);
    }
    controls = el("div", "", "lan-controls");
    content.append(heading, stats, keys, controls);
  }

  function renderControl(c: Control): HTMLElement {
    let record = controlNodes.get(c.id);
    if (!record || record.kind !== c.kind) {
      const node = el("div");
      record = { node, kind: c.kind };
      if (c.kind === "button") {
        record.button = button(c.label, () => send({ kind: "control", id: c.id }));
        node.append(record.button);
      } else if (c.kind === "label") node.textContent = c.label;
      else {
        const label = el("label"); const text = el("span");
        const field = c.kind === "select" ? el("select") : el("input");
        if (field instanceof HTMLInputElement) field.type = c.kind === "toggle" ? "checkbox" : "number";
        field.oninput = () => updateStatus();
        field.onchange = () => {
          if (field instanceof HTMLInputElement && field.type === "number" && (!field.value || !field.validity.valid)) return;
          send({ kind: "control", id: c.id, value:
            field instanceof HTMLInputElement && field.type === "checkbox" ? field.checked : Number(field.value) });
        };
        label.append(text, field); node.append(label);
        record.field = field; record.label = text;
      }
      controlNodes.set(c.id, record);
    }
    if (record.button) {
      const b = record.button;
      const purchase = c.purchase;
      if (purchase) {
        // Keep the button and its static sprite mounted as host values change.
        if (!record.purchase || record.purchase.slot !== purchase.slot) {
          const marker = el("span"); marker.setAttribute("aria-hidden", "true");
          const owned = el("span", "", "lan-shop-owned"); owned.title = "Owned";
          const icon = el("span", "", "lan-shop-icon"); icon.setAttribute("aria-hidden", "true");
          const sprite = get_sprite("A", purchase.slot, { color: WEAPON_ICON_BASE, pal: weapon_icon_palette(), scale: 2 });
          if (sprite) icon.append(sprite.canvas);
          const name = el("span", "", "lan-shop-name");
          const price = el("span", "", "lan-shop-price");
          b.replaceChildren(marker, owned, icon, name, price);
          record.purchase = { slot: purchase.slot, marker, owned, name, price };
        }
        const cells = record.purchase;
        cells.marker.textContent = purchase.selected ? ">" : "";
        cells.owned.textContent = String(purchase.owned);
        cells.name.textContent = purchase.name;
        cells.price.textContent = `$${purchase.price}/${purchase.bundle}`;
        b.classList.add("lan-shop-row");
        b.setAttribute("aria-pressed", String(purchase.selected));
        b.setAttribute("aria-label", `${purchase.name}, owned ${purchase.owned}, $${purchase.price} per ${purchase.bundle}`);
      } else {
        b.textContent = c.label;
        b.classList.remove("lan-shop-row");
        b.removeAttribute("aria-pressed");
        b.removeAttribute("aria-label");
        record.purchase = undefined;
      }
    }
    if (record.label) record.label.textContent = c.label;
    if (c.kind === "label") record.node.textContent = c.label;
    const field = record.field;
    field?.setAttribute("aria-label", c.label);
    if (field instanceof HTMLSelectElement) {
      const options = JSON.stringify(c.options);
      if (record.options !== options) {
        record.options = options;
        field.replaceChildren(...(c.options ?? []).map((text, i) => { const o = el("option", text); o.value = String(i); return o; }));
      }
    }
    if (field instanceof HTMLInputElement && c.kind === "number") {
      field.min = String(c.min); field.max = String(c.max); field.step = String(c.step ?? 1);
    }
    if (field && document.activeElement !== field) {
      if (field instanceof HTMLInputElement && c.kind === "toggle") field.checked = !!c.value;
      else field.value = String(c.value ?? "");
    }
    return record.node;
  }

  function renderView(): void {
    if (!view) return;
    buildGame();
    heading.textContent = `${view.tank?.name ?? "Player"} · ${view.screen} · Round ${view.round}`;
    const t = view.tank;
    if (t) {
      const [elev, side] = hudAngle(t.angle);
      stats.textContent = `Health ${t.health} · Cash $${t.cash} · Angle ${elev}${side} · Power ${t.power} · ${t.weapon} (${t.ammo})`;
    } else {
      stats.textContent = "";
    }
    const ids = new Set(view.controls.map((c) => c.id));
    for (const [id, record] of controlNodes) if (!ids.has(id)) { record.node.remove(); controlNodes.delete(id); }
    view.controls.forEach((c, index) => {
      const node = renderControl(c);
      if (controls.children[index] !== node) controls.insertBefore(node, controls.children[index] ?? null);
    });
    updateStatus();
  }

  function receive(m: ServerMessage): void {
    if (m.type === "joined") {
      token = m.token; playerId = m.player; room = m.room;
      try { localStorage.setItem(storageKey, token); } catch { /* warning was shown at boot */ }
      if (!room.started) lobby();
    } else if (m.type === "room" || m.type === "started") {
      room = m.room;
      if (!room.started) lobby();
      else if (!gameBuilt) { buildGame(); status.textContent = "Waiting for the host…"; }
    } else if (m.type === "state") {
      if (view?.context !== m.state.context || !m.state.enabled) release();
      view = m.state; renderView();
    } else if (m.type === "ended" || m.type === "replaced" || (m.type === "error" && m.fatal)) {
      release(); ended = true; view = undefined;
      status.textContent = m.message;
      content.replaceChildren();
    } else if (m.type === "error") error.textContent = m.message;
    updateStatus();
  }
  const connection = new Connection(() => ({ type: "join", room: roomId, token }), receive, (connected) => {
    if (!connected) { release(); view = undefined; }
    updateStatus();
  });
  window.addEventListener("keydown", (e) => {
    if (!gameBuilt || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    // Let the focused purchase button perform its native keyboard click.
    if (e.target instanceof Element && e.target.closest(".lan-shop-row") && (e.code === "Enter" || e.code === "Space")) return;
    if ((REMOTE_KEYS as readonly string[]).includes(e.code)) { e.preventDefault(); if (!e.repeat) key(e.code, true); }
  });
  window.addEventListener("keyup", (e) => { if (held.has(e.code)) { e.preventDefault(); key(e.code, false); } });
  window.addEventListener("blur", release);
  document.addEventListener("visibilitychange", () => { if (document.hidden) release(); });
  setInterval(() => { if (held.size) send({ kind: "hold", keys: [...held] }); }, 100);
}
