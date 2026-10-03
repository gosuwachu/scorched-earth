import type { ControllerView, Input, RoomView, ServerMessage, Control } from "../shared/online";
import { REMOTE_KEYS } from "../shared/online";
import { Connection } from "./online_connection";
import { button, el, installOnlineTheme, Roster, tankIcon } from "./online_ui";
import { get_sprite, WEAPON_ICON_BASE, weapon_icon_palette } from "./sprites";
import { PanelControls } from "./controller_panel";
import { BattleControls } from "./controller_battle";
import { ShopControls } from "./controller_shop";
import "./online.css";

interface ControlNode {
  node: HTMLElement;
  field?: HTMLInputElement | HTMLSelectElement;
  button?: HTMLButtonElement;
  label?: HTMLElement;
  readout?: HTMLOutputElement;
  kind: Control["kind"];
  options?: string;
  optionSlots?: (number | null)[];
  icon?: HTMLElement;
  iconSlot?: number | null;
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
  const keyLabels = new Map<string, string>();
  const battleLabels: Record<string, string> = {
    BracketLeft: "◀", Tab: "▶",
  };
  const targetLabels: Record<string, [string, string]> = {
    ArrowUp: ["↑", "Move target up"], ArrowLeft: ["←", "Move target left"],
    ArrowDown: ["↓", "Move target down"], ArrowRight: ["→", "Move target right"],
  };
  let name: HTMLInputElement;
  let readyButton: HTMLButtonElement;
  let roster: Roster;
  let panel: PanelControls;
  let keys: HTMLElement;
  let battle: BattleControls;
  let shop: ShopControls;
  let battleLayout = false;
  let screenKey = "";
  const focusHistory = new Map<string, HTMLElement>();
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
    if (!view?.targeting && view?.movement?.active && !view.movement.available && (code === "ArrowLeft" || code === "ArrowRight")) return;
    if (!allowed() || (view?.keys && !view.keys.includes(code)) ||
        (view?.screen !== "Battle" && !view?.targeting && code !== "Escape") ||
        (view?.targeting && !targetLabels[code] && code !== "Escape" && !code.startsWith("Digit")) ||
        (down ? held.has(code) : !held.has(code))) return;
    if (down && view?.targeting && code.startsWith("Digit")) release();
    if (down) held.add(code); else held.delete(code);
    send({ kind: "key", key: code, down });
    const b = heldButtons.get(code);
    if (b) b.dataset.held = String(down);
  };

  function updateStatus(): void {
    if (ended) return;
    const connected = connection.connected && !!room?.hostConnected;
    // Keep mounted forms and rows for reconnect, but expose no stale actions.
    content.hidden = !connected || (!!room?.started && !view);
    content.inert = content.hidden;
    status.textContent = !connection.connected ? "Connection lost. Reconnecting…" : !room?.hostConnected ?
      "Host unavailable. Waiting for the original host page to reconnect…" : view?.message ??
        (room.started ? "Waiting for the host…" : "Choose your tank and get ready.");
    const normalBattle = view?.screen === "Battle" && !view.targeting && !view.controls.some((c) => c.id === "plasma-charge");
    const dialogEscape = ["Tank controls", "Retreat"].includes(view?.screen ?? "");
    for (const [code, b] of heldButtons) {
      const targetArrow = !!view?.targeting && !!targetLabels[code];
      const relevant = targetArrow || (normalBattle && code !== "Enter") || (dialogEscape && code === "Escape");
      b.hidden = !relevant || (!!view?.keys && !view.keys.includes(code));
      b.disabled = b.hidden || !allowed() || (!view?.targeting && !!view?.movement?.active && !view.movement.available &&
        (code === "ArrowLeft" || code === "ArrowRight"));
      if (targetArrow) {
        b.textContent = targetLabels[code][0];
        b.setAttribute("aria-label", targetLabels[code][1]);
        b.title = targetLabels[code][1];
      } else if (normalBattle) {
        const moving = view?.movement?.active;
        const label = moving && code === "ArrowLeft" ? "Move left" : moving && code === "ArrowRight" ? "Move right" : keyLabels.get(code)!;
        b.textContent = battleLabels[code] || label;
        b.setAttribute("aria-label", label);
        b.title = label;
      }
    }
    if (gameBuilt) {
      battle.actions.hidden = false;
      if (view) battle.updateMovement(view, allowed());
      keys.hidden = !allowed() || !dialogEscape;
    }
    for (const [id, record] of controlNodes) {
      const c = view?.controls.find((c) => c.id === id);
      if (record.field) record.field.disabled = !allowed() || !!c?.disabled;
      if (record.button) record.button.disabled = !allowed() || !!c?.disabled;
    }
    shop?.setEnabled(allowed());
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
    panel = new PanelControls();
    keys = el("div", "", "lan-keys");
    for (const [label, code] of [
      ["Previous weapon", "BracketLeft"], ["↑ Power", "ArrowUp"], ["Next weapon", "Tab"],
      ["← Angle", "ArrowLeft"], ["↓ Power", "ArrowDown"], ["Angle →", "ArrowRight"],
      ["Fire", "Space"], ["Enter", "Enter"], ["Esc", "Escape"],
    ]) {
      const b = button(label, () => {});
      keyLabels.set(code, label);
      b.setAttribute("aria-label", label);
      b.dataset.key = code;
      b.setAttribute("aria-keyshortcuts", code === "BracketLeft" ? "[" : code);
      b.onpointerdown = (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); key(code, true); };
      b.onpointerup = (e) => { e.preventDefault(); key(code, false); };
      b.onpointercancel = () => { key(code, false); };
      b.onlostpointercapture = () => { if (held.has(code)) key(code, false); };
      // Keyboard/screen-reader activation emits a complete tap.
      b.onclick = (e) => { if (e.detail === 0) { key(code, true); key(code, false); } };
      b.oncontextmenu = (e) => e.preventDefault();
      heldButtons.set(code, b); keys.append(b);
    }
    battle = new BattleControls(() => send({ kind: "control", id: "move" }));
    shop = new ShopControls((value) => send({ kind: "control", id: "category", value }));
    panel.escape.append(keys);
    content.append(battle.element, shop.element, panel.element);
  }

  function updateSelectorIcon(record: ControlNode): void {
    if (!record.icon || !(record.field instanceof HTMLSelectElement)) return;
    record.icon.hidden = !record.optionSlots;
    const slot = record.optionSlots?.[Number(record.field.value)] ?? null;
    if (record.iconSlot === slot) return;
    record.iconSlot = slot;
    const sprite = slot === null ? null : get_sprite("A", slot, { color: WEAPON_ICON_BASE, pal: weapon_icon_palette(), scale: 2 });
    record.icon.replaceChildren(...(sprite ? [sprite.canvas] : []));
  }

  function renderControl(c: Control): HTMLElement {
    let record = controlNodes.get(c.id);
    if (!record || record.kind !== c.kind) {
      record?.node.remove();
      const node = el("div");
      node.dataset.controlId = c.id;
      record = { node, kind: c.kind };
      if (c.kind === "button") {
        record.button = button(c.label, () => {
          if (view?.targeting) release();
          send({ kind: "control", id: c.id });
        });
        node.append(record.button);
      } else if (c.kind === "label") node.textContent = c.label;
      else if (c.kind === "readout") {
        node.classList.add("lan-aim-group");
        record.label = el("span", "", "lan-battle-label");
        record.readout = el("output", "", "lan-coordinate-value");
        record.readout.setAttribute("aria-live", "off");
        node.append(record.label, record.readout);
      } else {
        const label = el("label"); const text = el("span");
        const field = c.kind === "select" ? el("select") : el("input");
        if (field instanceof HTMLInputElement) field.type = c.kind === "toggle" ? "checkbox" : "number";
        field.oninput = () => { updateSelectorIcon(controlNodes.get(c.id)!); updateStatus(); };
        field.onchange = () => {
          if (field instanceof HTMLInputElement && field.type === "number" && (!field.value || !field.validity.valid)) return;
          updateSelectorIcon(controlNodes.get(c.id)!);
          send({ kind: "control", id: c.id, value:
            field instanceof HTMLInputElement && field.type === "checkbox" ? field.checked : Number(field.value) });
        };
        label.append(text);
        if (field instanceof HTMLSelectElement) {
          const value = el("span", "", "lan-select-value");
          const icon = el("span", "", "lan-select-icon");
          icon.setAttribute("aria-hidden", "true");
          value.append(icon, field); label.append(value);
          record.icon = icon;
        } else label.append(field);
        node.append(label);
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
    record.node.classList.toggle("lan-primary", !!c.presentation?.primary);
    record.node.classList.toggle("lan-owned-row", c.id.startsWith("owned-"));
    record.node.classList.toggle("lan-toggle", c.kind === "toggle");
    if (record.label) record.label.textContent = c.label;
    if (record.readout) {
      record.readout.value = String(c.value ?? "");
      record.readout.setAttribute("aria-label", c.label);
    }
    if (c.kind === "label") record.node.textContent = c.label;
    const field = record.field;
    field?.setAttribute("aria-label", c.label);
    if (field instanceof HTMLSelectElement) {
      record.optionSlots = c.optionSlots;
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
    updateSelectorIcon(record);
    return record.node;
  }

  function renderView(): void {
    if (!view) return;
    buildGame();
    const nextScreenKey = `${view.screen}:${!!view.batteryPrompt}:${!!view.targeting}:${view.controls.some((c) => c.id === "plasma-charge")}`;
    const screenChanged = screenKey !== nextScreenKey;
    const active = document.activeElement;
    if (screenChanged && active instanceof HTMLElement && content.contains(active)) focusHistory.set(screenKey, active);
    // Different panels can reuse widget IDs for unrelated actions.
    if (screenChanged) {
      for (const record of controlNodes.values()) record.node.remove();
      controlNodes.clear();
      panel.body.scrollTop = 0;
      screenKey = nextScreenKey;
    }
    const t = view.tank;
    const purchasing = view.screen === "Purchasing";
    const useShop = purchasing && !!t;
    root.classList.toggle("lan-controller-shop", useShop);
    shop.element.hidden = !useShop;
    const useBattle = !!t && view.screen === "Battle" && !view.targeting &&
      !view.controls.some((c) => c.id === "plasma-charge");
    if (useBattle !== battleLayout || screenChanged) {
      release();
      battleLayout = useBattle;
      root.classList.toggle("lan-controller-battle", useBattle);
      battle.element.hidden = !useBattle;
      for (const [code, b] of heldButtons) {
        b.textContent = (useBattle && battleLabels[code]) || keyLabels.get(code)!;
        b.title = keyLabels.get(code)!;
        if (view.targeting && targetLabels[code]) panel.targetKeys.append(b);
        else if (!useBattle || code === "Enter") keys.append(b);
        else battle.mountKey(code, b);
      }
    }
    root.classList.add("lan-controller-game");
    root.classList.toggle("lan-controller-panel", !useBattle && !useShop);
    panel.element.hidden = useBattle || useShop;
    if (t && useBattle) battle.update(t, room?.players.findIndex((p) => p.id === playerId) ?? 0, view.round);
    const oldRows = [...shop.list.querySelectorAll<HTMLButtonElement>("button")];
    const focusedRow = oldRows.indexOf(document.activeElement as HTMLButtonElement);
    const scrollTop = shop.list.scrollTop;
    const visibleControls = view.controls.filter((c) => !(useShop && c.id === "category") && !(useBattle && c.id === "move"));
    const ids = new Set(visibleControls.map((c) => c.id));
    for (const [id, record] of controlNodes) if (!ids.has(id)) { record.node.remove(); controlNodes.delete(id); }
    const counts = new Map<HTMLElement, number>();
    visibleControls.forEach((c) => {
      const target = useShop ? shop.target(c) : !useBattle ? panel.target(c) : c.id === "tank" ? battle.panel : battle.extra;
      const index = counts.get(target) ?? 0;
      counts.set(target, index + 1);
      const node = renderControl(useBattle && c.id === "tank" ? { ...c, label: "Tank Control Panel" } : c);
      if (target.children[index] !== node) target.insertBefore(node, target.children[index] ?? null);
    });
    if (useShop) {
      shop.list.scrollTop = scrollTop;
      if (focusedRow >= 0 && !oldRows[focusedRow].isConnected) {
        const rows = [...shop.list.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        (rows[Math.min(focusedRow, rows.length - 1)] ?? shop.list).focus({ preventScroll: true });
      }
      shop.update(view, room?.players.findIndex((p) => p.id === playerId) ?? 0);
    }
    if (!useBattle && !useShop) panel.update(view, room?.players.findIndex((p) => p.id === playerId) ?? 0);
    battle.panel.hidden = !counts.has(battle.panel);
    battle.more.hidden = !counts.has(battle.extra);
    updateStatus();
    if (screenChanged && view.enabled) {
      const remembered = focusHistory.get(screenKey);
      const id = remembered?.closest<HTMLElement>("[data-control-id]")?.dataset.controlId;
      const restored = remembered?.isConnected ? remembered : id ? controlNodes.get(id)?.node.querySelector<HTMLElement>("button, input, select") : null;
      if (restored) restored.focus({ preventScroll: true });
      else if (!useBattle && !useShop) panel.heading.focus({ preventScroll: true });
    }
  }

  function receive(m: ServerMessage): void {
    if (m.type === "joined") {
      token = m.token; playerId = m.player; room = m.room;
      try { localStorage.setItem(storageKey, token); } catch { /* warning was shown at boot */ }
      if (!room.started) lobby();
    } else if (m.type === "room" || m.type === "started") {
      if (!m.room.hostConnected) { release(); view = undefined; }
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
      root.classList.remove("lan-controller-game", "lan-controller-battle", "lan-controller-shop", "lan-controller-panel");
    } else if (m.type === "error") error.textContent = m.message;
    updateStatus();
  }
  const connection = new Connection(() => ({ type: "join", room: roomId, token }), receive, (connected) => {
    if (!connected) { release(); view = undefined; }
    updateStatus();
  });
  window.addEventListener("keydown", (e) => {
    if (!gameBuilt || e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (view?.screen !== "Battle" && !view?.targeting && e.code !== "Escape") return;
    if (view?.targeting && !targetLabels[e.code] && e.code !== "Escape" && !e.code.startsWith("Digit")) return;
    // Native navigation/activation must work for the disclosure and focused controls.
    // Tab cycles weapons only when focus is outside an interactive control.
    if (e.target instanceof Element && e.target.closest("button, summary") &&
        (e.code === "Enter" || e.code === "Space" || e.code === "Tab")) return;
    if ((REMOTE_KEYS as readonly string[]).includes(e.code)) { e.preventDefault(); if (!e.repeat) key(e.code, true); }
  });
  window.addEventListener("keyup", (e) => { if (held.has(e.code)) { e.preventDefault(); key(e.code, false); } });
  window.addEventListener("blur", release);
  document.addEventListener("visibilitychange", () => { if (document.hidden) release(); });
  setInterval(() => { if (held.size) send({ kind: "hold", keys: [...held] }); }, 100);
}
