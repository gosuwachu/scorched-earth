/** Screen-specific content composed from the shared HTML controls. */
import * as S from "../screens";
import * as W from "../widgets";
import * as weapons from "../weapons";
import * as sprites from "../sprites";
import * as pg from "../pygame";
import { TEAM_RGB } from "../palette";
import { button, el, KeyedList, type Component } from "./components";
import { PanelView, type WidgetActions } from "./widgets";

export function position(node: HTMLElement, panel: W.Panel, x: number, y: number, width: number, height?: number): void {
  node.classList.add("ui-extra");
  Object.assign(node.style, { left: `${x - panel.rect.x - 2}px`, top: `${y - panel.rect.y - (panel.title ? 24 : 2)}px`, width: `${width}px` });
  if (height !== undefined) node.style.height = `${height}px`;
}

export class ScreenContent implements Component<boolean> {
  readonly element = el("div");
  private updates: Array<(active: boolean) => void> = [];
  private owned: HTMLElement[] = [];
  constructor(screen: object, view: PanelView, actions: WidgetActions) {
    const p = view.model;
    const add = (node: HTMLElement, x: number, y: number, width: number, height?: number) => {
      position(node, p, x, y, width, height); view.body.append(node); this.owned.push(node); return node;
    };
    if (screen instanceof S.RegistrationScreen) {
      const text = el("div", S.REGISTRATION_LINES.join("\n"), "ui-status");
      add(text, screen._text_x, screen._text_y, p.rect.w - 48);
    }
    if (screen instanceof S.OptionsScreen && screen.spec === "weapons") {
      const section = el("section", "", "ui-weapon-options");
      const heading = el("h2", "Shop availability");
      const help = el("p", "Checked equipment can appear in the shop if its tier is allowed by Arms Level. Uncheck an item to exclude it.", "ui-option-help");
      help.id = `${view.heading.id}-availability-help`;
      const list = el("div", "", "ui-weapon-options-list");
      list.setAttribute("role", "group"); list.setAttribute("aria-label", "Equipment allowed in the shop");
      list.setAttribute("aria-describedby", help.id);
      const page = (delta: number) => actions.change(() => {
        const focused = [...list.querySelectorAll("input")].indexOf(document.activeElement as HTMLInputElement);
        screen.scroll = Math.max(0, Math.min(Math.max(0, screen.weapon_items.length - screen._wl_h), screen.scroll + delta));
        screen._refresh_weapon_toggles();
        if (focused >= 0) queueMicrotask(() => list.querySelectorAll("input")[focused]?.focus({ preventScroll: true }));
      });
      const prev = button("↑ Previous weapons", () => page(-screen._wl_h));
      const next = button("↓ More weapons", () => page(screen._wl_h));
      const row = el("div", "", "ui-weapon-options-nav"); row.append(prev, next);
      section.append(heading, help, list, row); view.body.append(section); this.owned.push(section);
      this.updates.push((active) => {
        for (const toggle of screen._wl_toggles) view.place(toggle, list);
        prev.disabled = !active || screen.scroll === 0;
        next.disabled = !active || screen.scroll >= screen.weapon_items.length - screen._wl_h;
      });
      list.addEventListener("wheel", (e) => {
        if (!e.deltaY || (e.deltaY < 0 ? prev.disabled : next.disabled)) return;
        e.preventDefault(); page(Math.sign(e.deltaY));
      }, { passive: false });
    }
    if (screen instanceof S.ShopScreen) {
      const name = el("strong"); name.style.color = `rgb(${TEAM_RGB[(screen.tank.player_index ?? 0) % TEAM_RGB.length].join(",")})`;
      const cash = el("strong"); const rounds = el("span");
      const bar = el("div"); bar.style.display = "flex"; bar.style.justifyContent = "space-between"; bar.append(name, cash, rounds);
      add(bar, p.rect.x + 12, p.rect.y + 26, screen._list_right - p.rect.x - 12);
      const list = new KeyedList<number>("div", String, (slot) => {
        const row = button("", () => actions.change(() => { screen.sel_row = screen.items.indexOf(slot); }));
        row.className = "ui-shop-row";
        row.append(el("span"), el("span"), el("canvas"), el("span"), el("span"));
        return row;
      }, (row, slot, index) => {
        const item = weapons.ITEMS[slot];
        const cells = row.children;
        cells[0].textContent = index === screen.sel_row ? ">" : "";
        cells[1].textContent = String(screen.tank.inventory[slot]);
        cells[3].textContent = item.name; cells[4].textContent = `$${screen.econ.price[slot]}/${item.bundle}`;
        row.setAttribute("aria-pressed", String(index === screen.sel_row));
        row.setAttribute("aria-label", `${item.name}, owned ${screen.tank.inventory[slot]}, $${screen.econ.price[slot]} per ${item.bundle}`);
        const canvas = cells[2] as HTMLCanvasElement;
        if (row.dataset.cycle !== String(screen._cycle_counter)) {
          row.dataset.cycle = String(screen._cycle_counter);
          const sprite = sprites.get_sprite("A", slot, { color: S.SHOP_ICON_BASE, pal: screen.shop_lut.table, scale: 1 });
          if (sprite) { if (canvas.width !== sprite.get_width()) canvas.width = sprite.get_width(); if (canvas.height !== sprite.get_height()) canvas.height = sprite.get_height(); canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height); canvas.getContext("2d")!.drawImage(sprite.canvas, 0, 0); }
          canvas.setAttribute("aria-hidden", "true");
        }
      });
      list.element.className = "ui-list"; list.element.tabIndex = 0; list.element.setAttribute("aria-label", "Available equipment");
      add(list.element, screen._list_x, screen._grid_top, screen._list_right - screen._list_x, screen.rows_visible * 18);
      let lastScroll = screen.scroll;
      let lastSelection = screen.items[screen.sel_row];
      list.element.addEventListener("scroll", () => { actions.change(() => { screen.scroll = Math.min(screen._max_scroll(), Math.floor(list.element.scrollTop / 18)); lastScroll = screen.scroll; }); });
      this.updates.push((active) => {
        name.textContent = screen.tank.name; cash.textContent = `Cash: $${screen.tank.cash}`;
        const n = screen.state.cfg.MAXROUNDS - screen.state.round_index; rounds.textContent = n === 1 ? "1 round remains" : `${n} rounds remain`;
        list.update(screen.items);
        for (const node of list.element.querySelectorAll("button")) node.disabled = !active;
        if (lastScroll !== screen.scroll) { list.element.scrollTop = screen.scroll * 18; lastScroll = screen.scroll; }
        if (lastSelection !== screen.items[screen.sel_row]) {
          lastSelection = screen.items[screen.sel_row];
          list.element.querySelector("[aria-pressed=true]")?.scrollIntoView({ block: "nearest" });
        }
      });
    }
    if (screen instanceof S.InventoryScreen) {
      screen._layout_lists();
      const listWidth = screen._gcol_x - screen._wcol_x - 16;
      const makeList = (kind: "weapon" | "guidance", x: number) => {
        const list = new KeyedList<number | null>("div", String, (slot) => button("", () => actions.change(() => {
          if (kind === "weapon" && slot !== null) screen._select_weapon(slot); else if (kind === "guidance") screen._select_guidance(slot);
        })), (row, slot) => {
          row.textContent = slot === null ? "None" : `${weapons.ITEMS[slot].name}   ${screen._count_str(slot)}`;
          row.setAttribute("aria-pressed", String(slot === (kind === "weapon" ? screen.tank.selected_weapon : screen.tank.selected_guidance)));
        });
        const section = el("section"); section.append(el("strong", kind === "weapon" ? "Weapons" : "Guidance"), list.element);
        list.element.className = "ui-list"; list.element.tabIndex = 0; list.element.setAttribute("aria-label", kind === "weapon" ? "Weapons" : "Guidance");
        add(section, x, screen._list_top - 18, listWidth, screen._array_y - screen._list_top - 25);
        section.style.overflow = "auto";
        this.updates.push((active) => { list.update(kind === "weapon" ? screen.weapon_slots : [...screen.guidance_slots, null]); for (const node of list.element.querySelectorAll("button")) node.disabled = !active; });
      };
      makeList("weapon", screen._wcol_x); makeList("guidance", screen._gcol_x);
      const counts = el("div", "", "ui-status");
      add(counts, screen._gcol_x, Math.max(screen._guidance_bottom, screen._array_y - 110) + 8, listWidth);
      this.updates.push(() => { const inv = screen.tank.inventory; counts.textContent = `Shields: ${weapons.SHIELD_SLOTS.reduce((n, slot) => n + inv[slot], 0)}\nParachutes: ${inv[weapons.SLOT_PARACHUTE]}\nBatteries: ${inv[weapons.SLOT_BATTERY]}\nTriggers: ${inv[weapons.SLOT_CONTACT_TRIGGER]}\nFuel: ${inv[weapons.SLOT_FUEL]}`; });
      if (screen.weapon_array) add(el("span", "Weapon array (click to select):"), screen._wcol_x, screen._array_y - 18, listWidth);
    }
    if (screen instanceof S.SaveScreen || screen instanceof S.RestoreScreen) {
      const list = new KeyedList<string>("div", (name) => name, (name) => button(`${name}${S.SAVE_EXT}`, () => actions.change(() => { screen.name = name; })), (row, name) => row.setAttribute("aria-pressed", String(screen.name === name)));
      list.element.className = "ui-list"; list.element.tabIndex = 0; list.element.setAttribute("aria-label", "Existing saves");
      add(list.element, p.rect.x + 18, screen._list_top, p.rect.w - 36, screen._row_h * screen._list_rows);
      const empty = add(el("span", "(none)"), p.rect.x + 18, screen._list_top, p.rect.w - 36);
      const status = add(el("div", "", "ui-error"), p.rect.x + 18, p.rect.bottom - 62, p.rect.w - 36);
      status.setAttribute("role", "status");
      this.updates.push((active) => { list.update(screen.saves); empty.hidden = screen.saves.length > 0; status.textContent = screen.status; status.hidden = !screen.status; for (const node of list.element.querySelectorAll("button")) node.disabled = !active; });
    }
  }
  update(active: boolean): void { this.updates.forEach((run) => run(active)); }
  dispose(): void { this.owned.forEach((node) => node.remove()); this.updates = []; }
}

export function menuArt(screen: S.MainMenuScreen): HTMLElement {
  const art = el("section", "", "ui-art");
  const r = screen.art_rect;
  Object.assign(art.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  const copy = new pg.Surface(screen._backdrop.get_size()); copy.blit(screen._backdrop, [0, 0]); copy.canvas.setAttribute("aria-hidden", "true");
  const title = el("h1"); title.append("SCORCHED", el("br"), "EARTH");
  art.append(copy.canvas, title, el("p", "The Mother of All Games"), el("p", "Shareware Version"), el("small", "Version 1.50 · Copyright (c) 1991–1995 Wendell Hicken"));
  return art;
}
