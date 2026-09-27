/** Synchronizes persistent HTML views with the game's screen stack. */
import type { App } from "../main";
import * as S from "../screens";
import * as I from "../ingame";
import * as W from "../widgets";
import * as pg from "../pygame";
import * as ranks from "../ui";
import type { GameState } from "../game";
import type { ScreenEvent } from "../screen";
import { ITEMS } from "../weapons";
import { sfx } from "../sound";
import { button, el, installTheme, modalShell } from "./components";
import { PanelView, type WidgetActions } from "./widgets";
import { ScreenContent, menuArt } from "./screens";
import { describeOption } from "./option_help";

export interface HtmlScreen {
  opaque?: boolean;
  uiKind?: "battle" | "rankings" | "finished";
  panel?: W.Panel | null;
  title?: string;
  quote?: readonly [string, string] | null;
  handle(event: ScreenEvent): string | null;
  dispatchAction?(action: string | null): string | null;
  syncUi?(): void;
}
interface View {
  screen: HtmlScreen;
  panel?: W.Panel;
  element: HTMLElement;
  dialog?: HTMLDialogElement;
  widgets?: PanelView;
  content?: ScreenContent;
  update?: (active: boolean) => void;
  returnFocus: HTMLElement | null;
}
interface Description { key: object; screen: HtmlScreen; panel?: W.Panel; modal: boolean; nested?: boolean; }

/** Used by the input pump, independent of online-specific CSS selectors. */
export function uiOwnsInput(): boolean {
  return typeof document !== "undefined" && !!document.querySelector("dialog[open], [data-ui-screen]:not([hidden])");
}

export class UiHost {
  readonly element = el("div", "", "ui-stage");
  private views = new Map<object, View>();
  private order: Description[] = [];
  private animations = new Set<Animation>();
  private abort = new AbortController();
  private resizing: ResizeObserver;
  private syncing = false;
  private chargeKey: object | null = null;
  private activeKey: object | null = null;
  constructor(private app: App, private canvas: HTMLCanvasElement, private releaseInput: () => void) {
    installTheme(); this.element.dataset.uiOwner = "true";
    document.body.append(this.element);
    this.resizing = new ResizeObserver(() => this.layout()); this.resizing.observe(canvas);
    window.addEventListener("resize", () => this.layout(), { signal: this.abort.signal });
    window.addEventListener("keydown", (event) => this.keydown(event), { signal: this.abort.signal });
    window.addEventListener("blur", releaseInput, { signal: this.abort.signal });
    this.layout(); this.sync();
  }
  get transitioning(): boolean { return this.animations.size > 0; }
  finishTransition(): void { for (const animation of [...this.animations]) animation.finish(); }
  isHtml(screen: HtmlScreen): boolean { return !!screen.panel || screen instanceof I.RetreatScreen || screen.uiKind === "rankings" || screen.uiKind === "finished"; }
  private modal(screen: HtmlScreen): boolean {
    return !(screen instanceof S.MainMenuScreen || screen instanceof S.RegistrationScreen || screen instanceof S.TankInitScreen || screen instanceof S.ShopScreen || screen instanceof S.InventoryScreen);
  }
  private layout(): void {
    const r = this.canvas.getBoundingClientRect();
    // Layout is in the original logical pixels; only roomy desktop views scale.
    const compact = innerWidth < 800 || innerHeight < 600;
    const scale = compact ? 1 : r.width / this.app.w || 1;
    Object.assign(this.element.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${this.app.w}px`, height: `${this.app.h}px`, transformOrigin: "top left", transform: compact ? "none" : `scale(${scale})` });
    this.element.style.setProperty("--game-bottom", `${Math.max(0, innerHeight - r.bottom - r.top)}px`);
    for (const view of this.views.values()) if (view.dialog) {
      if (view.screen instanceof S.OptionsScreen) {
        // Reading help should not depend on the game's chosen pixel resolution.
        Object.assign(view.dialog.style, { zoom: "1", left: "", top: "", right: "", bottom: "", margin: "", translate: "" });
        continue;
      }
      view.dialog.style.zoom = String(scale);
      Object.assign(view.dialog.style, compact ? { left: "", top: "", right: "", bottom: "", margin: "", translate: "" } : {
        left: `${r.left / scale + (view.panel?.rect.x ?? this.app.w / 2)}px`,
        top: `${r.top / scale + (view.panel?.rect.y ?? this.app.h / 2)}px`,
        right: "auto", bottom: "auto", margin: "0", translate: view.panel ? "none" : "-50% -50%",
      });
    }
  }
  private permitted(screen: HtmlScreen): boolean {
    return this.app.top === screen && (!this.app.online || this.app.onlineScreen === "admin") && !this.app.online?.paused;
  }
  private act(screen: HtmlScreen, action: string | null): void {
    if (!this.permitted(screen)) return;
    if (this.transitioning) { this.finishTransition(); return; }
    this.app.dispatchAction(action);
    this.sync();
  }
  private change(screen: HtmlScreen, run: () => void): void {
    if (!this.permitted(screen)) return;
    if (this.transitioning) { this.finishTransition(); return; }
    run(); this.sync();
  }
  private describe(): Description[] {
    const descriptions: Description[] = [];
    for (const raw of this.app.stack) {
      const screen = raw as unknown as HtmlScreen;
      if (!this.isHtml(screen)) continue;
      const panel = screen instanceof I.RetreatScreen ? screen.confirm.panel : screen.panel ?? undefined;
      descriptions.push({ key: screen, screen, panel, modal: this.modal(screen) });
      const nested = screen instanceof I.ControlPanelScreen ? screen.discharge_modal?.panel : screen instanceof I.SystemMenuScreen ? screen.confirm?.panel : screen instanceof S.SaveScreen ? screen._confirm : null;
      if (nested) descriptions.push({ key: nested, screen, panel: nested, modal: true, nested: true });
    }
    return descriptions;
  }
  sync(): void {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const descriptions = this.describe();
      const keys = new Set(descriptions.map((d) => d.key));
      if (this.chargeKey) keys.add(this.chargeKey);
      for (const [key, view] of [...this.views].reverse()) if (!keys.has(key)) { this.views.delete(key); this.retire(view); }
      this.order = descriptions;
      const top = descriptions[descriptions.length - 1];
      if ((top?.key ?? null) !== this.activeKey) { this.releaseInput(); this.activeKey = top?.key ?? null; }
      let firstVisible = 0;
      descriptions.forEach((d, i) => { if (!d.modal) firstVisible = i; });
      descriptions.forEach((d, i) => {
        d.screen.syncUi?.();
        let view = this.views.get(d.key);
        if (view && view.panel !== d.panel) {
          // Some operations rebuild widget models while retaining the screen.
          this.replacePanel(view, d);
        }
        if (!view) { view = this.create(d); this.views.set(d.key, view); }
        view.element.hidden = i < firstVisible;
        const active = d === top && this.permitted(d.screen);
        view.element.inert = d !== top;
        view.widgets?.update(active);
        view.content?.update(active);
        view.update?.(active);
        if (d.screen instanceof S.TankInitScreen && view.widgets) {
          view.widgets.hide(d.screen.radio, !d.screen.is_computer);
          view.widgets.hide(d.screen.name_field, d.screen.is_computer);
          view.widgets.hide(d.screen.name_label, d.screen.is_computer);
          for (const frame of d.screen.sim_frames) view.widgets.hide(frame, d.screen.is_computer);
        }
        if (view.dialog && !view.dialog.open) {
          // Player screens are read-only on the host; keep the host's LAN bar usable.
          if (this.app.online) view.dialog.show(); else view.dialog.showModal();
          this.animate(view, true);
        }
      });
      this.syncCharge();
      this.layout();
    } finally { this.syncing = false; }
  }
  private actions(d: Description): WidgetActions {
    return {
      activate: (action) => { if (this.order[this.order.length - 1]?.key === d.key) this.act(d.screen, action); },
      change: (run) => { if (this.order[this.order.length - 1]?.key === d.key) this.change(d.screen, run); },
      description: (widget) => {
        const screen = d.screen;
        if (!(screen instanceof S.OptionsScreen)) return undefined;
        const key = screen.optionKeys.get(widget);
        return describeOption(key, key === undefined ? undefined : screen.cfg[key]);
      },
      label: (widget) => {
        const screen = d.screen;
        if (screen instanceof S.TankInitScreen) {
          if (widget === screen.icon_slider || widget === screen.icons) return "Tank design";
          if (widget === screen.type_slider || widget === screen.type_icons) return "Player type";
        }
        if (screen instanceof I.ReassignPlayersScreen && d.panel) {
          const index = Math.floor(d.panel.widgets.indexOf(widget) / 2) + 1;
          if (widget instanceof W.TextField) return `Player ${index} name`;
          if (widget instanceof W.Selector) return `Player ${index} controller`;
        }
        if (screen instanceof S.ConfigureTeamsScreen && widget instanceof W.Spinner && d.panel) {
          const index = Math.floor(d.panel.widgets.indexOf(widget) / 2);
          return `Team for ${screen.tanks[index].name}`;
        }
        return undefined;
      },
      iconLabels: (widget) => {
        const screen = d.screen;
        if (screen instanceof S.ShopScreen) return ["Weapons", "Miscellaneous"];
        if (screen instanceof S.TankInitScreen) return widget === screen.type_icons ? ["Person", "Computer"] : widget.cells.map((_, i) => `Tank design ${i + 1}`);
        if (screen instanceof S.InventoryScreen) return screen._array_slots.map((slot) => weaponsName(slot));
        return undefined;
      },
    };
  }
  private replacePanel(view: View, d: Description): void {
    const focused = view.element.contains(document.activeElement) ? (document.activeElement as HTMLElement).getAttribute("aria-label") || (document.activeElement as HTMLElement).textContent : null;
    view.content?.dispose(); view.widgets?.dispose();
    view.panel = d.panel;
    if (d.panel) {
      const actions = this.actions(d);
      view.widgets = new PanelView(d.panel, actions, d.screen instanceof S.OptionsScreen); view.widgets.update(this.permitted(d.screen));
      view.element.append(view.widgets.element);
      view.element.setAttribute("aria-labelledby", view.widgets.heading.id);
      view.content = d.nested ? undefined : new ScreenContent(d.screen, view.widgets, actions);
      if (focused) {
        const control = [...view.element.querySelectorAll<HTMLElement>("button, input")].find((node) => (node.getAttribute("aria-label") || node.textContent) === focused);
        (control ?? view.element.querySelector<HTMLElement>("[data-default]"))?.focus({ preventScroll: true });
      }
    }
  }
  private create(d: Description): View {
    const element = d.modal ? modalShell({ className: "ui-compact ui-local-dialog", cancel: () => {
      const panel = this.views.get(d.key)?.panel ?? d.panel;
      if (panel && !panel.no_cancel) this.act(d.screen, panel.cancel_action);
    } }) : el("div", "", "se-ui ui-compact ui-screen");
    element.dataset.uiScreen = d.screen.constructor.name;
    if (d.screen instanceof S.OptionsScreen) element.classList.add("ui-options");
    element.dataset.uiOwner = "true";
    const view: View = { screen: d.screen, element, returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null };
    if (element instanceof HTMLDialogElement) {
      view.dialog = element;
      element.addEventListener("click", (e) => {
        if (e.target !== element || !d.panel || d.panel.no_cancel) return;
        const r = element.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) this.act(d.screen, d.panel.cancel_action);
      });
      document.body.append(element);
    } else this.element.append(element);
    this.replacePanel(view, d);
    if (d.screen instanceof S.MainMenuScreen) element.append(menuArt(d.screen));
    if (d.screen instanceof S.TankInitScreen) element.style.background = "transparent";
    if (d.screen.uiKind === "rankings" || d.screen.uiKind === "finished") this.results(view, d.screen);
    if (view.widgets) element.setAttribute("aria-labelledby", view.widgets.heading.id);
    queueMicrotask(() => { if (element.isConnected && this.order[this.order.length - 1]?.key === d.key && this.permitted(d.screen)) view.widgets?.focusDefault(); });
    return view;
  }
  private results(view: View, screen: HtmlScreen): void {
    const gs = this.app.gs as unknown as GameState;
    const final = screen.uiKind === "finished";
    const title = final ? (gs.winner ? "Final Scoring" : "No Winner") : screen.title ?? "Player Rankings";
    const layout = ranks.rankings_layout(this.app.renderer as never, gs as never, title, final ? null : gs.cfg.MAXROUNDS - gs.round_index, screen.quote ? [...screen.quote] : null);
    const section = el("section", "", "ui-results");
    const heading = el("h1", title); heading.id = `ui-results-${final ? "final" : "round"}`; section.append(heading);
    view.element.setAttribute("aria-labelledby", heading.id);
    const table = el("table"); const head = el("tr");
    for (const label of ["Rank", "Player", "Wins", "Cash"]) head.append(el("th", label));
    const thead = el("thead"); thead.append(head); const body = el("tbody");
    layout.ranked.forEach((tank, i) => { const row = el("tr"); row.style.color = `rgb(${layout.row_colors[i].join(",")})`; for (const text of [`#${i + 1}`, tank.name, String(tank.win_counter), `$${tank.cash}`]) row.append(el("td", text)); body.append(row); });
    table.append(thead, body); section.append(table);
    if (!final) section.append(el("p", `${gs.cfg.MAXROUNDS - gs.round_index} rounds remain.`));
    if (layout.qlines.length) section.append(el("p", layout.qlines.join("\n"), "ui-status"));
    const footer = el("div", "", "ui-dialog-footer");
    const go = button("Go", () => this.change(screen, () => this.app._act(final ? "to_menu" : "rankings_done"))); go.dataset.default = "true";
    footer.append(go); section.append(footer); view.element.append(section);
    view.update = (active) => { go.disabled = !active; };
  }
  private syncCharge(): void {
    const gs = this.app.gs as unknown as GameState | null;
    const charge = this.app.onlineScreen === "battle" ? gs?.plasma_charge : null;
    if (this.chargeKey && this.chargeKey !== charge) { const view = this.views.get(this.chargeKey); if (view) { this.views.delete(this.chargeKey); this.retire(view); } this.chargeKey = null; }
    if (!charge || !gs) return;
    // Charge objects persist while editing. It is an in-battle dialog, not a HUD change.
    this.chargeKey = charge;
    let view = this.views.get(charge);
    if (!view) {
      const screen = this.app.top as unknown as HtmlScreen;
      const element = modalShell({ className: "ui-compact ui-local-dialog ui-results", cancel: () => this.change(screen, () => gs.cancel_plasma_charge()) }); element.dataset.uiScreen = "PlasmaCharge";
      const heading = el("h1", "Plasma Blast — Batteries"); heading.id = "ui-plasma-title"; element.setAttribute("aria-labelledby", heading.id);
      const row = el("div", "", "ui-icons");
      const choices = Array.from({ length: 11 }, (_, n) => button(String(n), () => this.change(screen, () => gs.set_plasma_charge(n)))); row.append(...choices);
      const fire = button("Fire", () => this.change(screen, () => gs.confirm_plasma_charge()));
      const cancel = button("Cancel", () => this.change(screen, () => gs.cancel_plasma_charge()));
      const footer = el("div", "", "ui-dialog-footer"); footer.append(fire, cancel); element.append(heading, row, footer);
      document.body.append(element); if (this.app.online) element.show(); else element.showModal();
      this.releaseInput();
      view = { screen, element, dialog: element, returnFocus: null, update: (active) => { choices.forEach((b, n) => { b.disabled = !active || n > charge.max; b.setAttribute("aria-pressed", String(n === charge.value)); }); fire.disabled = cancel.disabled = !active; } };
      this.views.set(charge, view);
    }
    view.update?.(!this.app.online);
  }
  private keydown(event: KeyboardEvent): void {
    // External online dialogs own their own keyboard; never activate the screen below.
    const dialogs = [...document.querySelectorAll<HTMLDialogElement>("dialog[open]")];
    const lastDialog = dialogs[dialogs.length - 1];
    if (lastDialog && !lastDialog.dataset.uiScreen) return;
    if (event.target instanceof Element && event.target.closest(".lan-bar")) return;
    if (event.isComposing || event.key === "F11" || (event.altKey && event.key === "Enter")) return;
    if (this.transitioning) { event.preventDefault(); this.finishTransition(); return; }
    const d = this.order[this.order.length - 1];
    const gs = this.app.gs as unknown as GameState | null;
    if (this.chargeKey && gs?.plasma_charge) {
      if (this.app.online || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", "Escape", " ", ..."0123456789"].includes(event.key)) return;
      event.preventDefault(); this.app._act(this.app.top.handle({ type: pg.KEYDOWN, key: pg.keyToPygame(event), unicode: pg.unicodeFor(event) })); this.sync(); return;
    }
    if (!d || !this.permitted(d.screen)) return;
    const target = event.target as HTMLElement;
    if (d.screen instanceof S.CalibrateScreen && event.key !== "Tab") {
      event.preventDefault(); this.change(d.screen, () => this.app._act(d.screen.handle({ type: pg.KEYDOWN, key: pg.keyToPygame(event) }))); return;
    }
    if (event.key === "Tab") {
      const element = this.views.get(d.key)!.element;
      const controls = [...element.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex='0']")].filter((node) => node.getClientRects().length && !node.closest("[hidden]"));
      const index = controls.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); controls[controls.length - 1]?.focus(); }
      else if (!event.shiftKey && index === controls.length - 1) { event.preventDefault(); controls[0]?.focus(); }
      return;
    }
    const text = target instanceof HTMLInputElement && target.type === "text";
    if (event.key === "Escape") { event.preventDefault(); if (d.panel && !d.panel.no_cancel) this.act(d.screen, d.panel.cancel_action); return; }
    if (event.key === "Enter" && d.panel?.default_widget) { event.preventDefault(); this.act(d.screen, d.panel.default_widget.action); return; }
    if (text || event.ctrlKey || event.metaKey || event.altKey) return;
    if (!d.panel) {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); this.change(d.screen, () => this.app._act(d.screen.uiKind === "finished" ? "to_menu" : "rankings_done")); }
      return;
    }
    if (d.screen instanceof S.ShopScreen && ["ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(event.key)) {
      event.preventDefault(); this.change(d.screen, () => this.app._act(d.screen.handle({ type: pg.KEYDOWN, key: pg.keyToPygame(event) }))); return;
    }
    if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !(target instanceof HTMLInputElement)) {
      const owner = this.views.get(d.key)!;
      const controls = [...owner.element.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled)")].filter((node) => node.getClientRects().length && !node.closest("[hidden]"));
      const index = controls.indexOf(document.activeElement as HTMLElement);
      event.preventDefault(); controls[(index + (event.key === "ArrowDown" ? 1 : -1) + controls.length) % controls.length]?.focus(); return;
    }
    const ch = event.key.toLowerCase();
    for (const w of d.panel.widgets) {
      if (!w.enabled) continue;
      if (w instanceof W.RadioGroup && w.cell_accels.includes(ch)) { event.preventDefault(); this.change(d.screen, () => w.accel_hit(ch)); return; }
      if (w.accel !== ch) continue;
      event.preventDefault();
      if (w instanceof W.Button || (w instanceof W.Label && w.clickable)) this.act(d.screen, w.action);
      else this.change(d.screen, () => w.on_accel());
      return;
    }
  }
  private animate(view: View, opening: boolean, done?: () => void): void {
    sfx.play(opening ? "dialog_open" : "dialog_close", this.app.cfg.is_on("SOUND"));
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || !view.element.animate) { done?.(); return; }
    const frames = [{ transform: "scale(.05)", opacity: .2 }, { transform: "scale(1)", opacity: 1 }];
    const animation = view.element.animate(opening ? frames : frames.reverse(), { duration: 1000 / 3, easing: "linear" });
    this.animations.add(animation);
    const finish = () => { this.animations.delete(animation); done?.(); };
    animation.onfinish = finish; animation.oncancel = finish;
  }
  private retire(view: View): void {
    view.element.inert = true;
    const dispose = () => {
      view.dialog?.close(); view.content?.dispose(); view.widgets?.dispose(); view.element.remove();
      if (view.returnFocus?.isConnected && !view.returnFocus.closest("[inert], [hidden]")) view.returnFocus.focus({ preventScroll: true });
      else {
        const active = this.order[this.order.length - 1];
        const owner = active ? this.views.get(active.key) : undefined;
        const action = view.returnFocus?.dataset.uiAction;
        const replacement = action && owner ? [...owner.element.querySelectorAll<HTMLElement>("[data-ui-action]")].find((node) => node.dataset.uiAction === action) : undefined;
        (replacement ?? owner?.element.querySelector<HTMLElement>("[data-default]:not(:disabled)"))?.focus({ preventScroll: true });
      }
    };
    if (view.dialog?.open) this.animate(view, false, dispose); else dispose();
  }
  dispose(): void {
    this.abort.abort(); this.resizing.disconnect(); this.finishTransition();
    for (const view of this.views.values()) { view.dialog?.close(); view.content?.dispose(); view.widgets?.dispose(); view.element.remove(); }
    this.views.clear(); this.element.remove(); this.releaseInput();
  }
}

function weaponsName(slot: number): string { return ITEMS[slot].name; }
