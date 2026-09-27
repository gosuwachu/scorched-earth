/** HTML presentation of the existing, differential-tested widget models. */
import * as W from "../widgets";
import * as pg from "../pygame";
import { button, caption, el, field, value, type Component } from "./components";

export interface WidgetActions {
  activate(action: W.Action): void;
  change(run: () => void): void;
  label?(widget: W.Widget): string | undefined;
  iconLabels?(widget: W.IconStrip): string[] | undefined;
}

let nextGroup = 0;
export class WidgetView implements Component<boolean> {
  readonly element: HTMLElement;
  private refresh: () => void = () => {};
  private controls: Array<HTMLInputElement | HTMLSelectElement | HTMLButtonElement> = [];
  private labelNode: HTMLElement | null = null;
  constructor(readonly model: W.Widget, private actions: WidgetActions, label: string) {
    const w = model;
    const change = (run: () => void) => actions.change(run);
    if (w instanceof W.Button || (w instanceof W.Label && w.clickable)) {
      this.element = button("", () => actions.activate(w.action));
      this.labelNode = this.element;
      if (typeof w.action === "string") this.element.dataset.uiAction = w.action;
      if (w instanceof W.Label) this.element.classList.add("ui-flat");
      if (w.action === "move_left" || w.action === "move_right") { this.element.setAttribute("aria-label", W.plain(w.label)); this.element.style.fontSize = "11px"; this.element.style.padding = "0"; }
      if (w instanceof W.Button && w.default) this.element.dataset.default = "true";
    } else if (w instanceof W.TextField) {
      const input = el("input"); input.type = "text"; input.maxLength = w.maxlen;
      input.setAttribute("aria-label", W.plain(label));
      input.autocomplete = "off"; input.spellcheck = false;
      const commit = () => change(() => {
        // Match the legacy editor's printable-character rule for pasted/IME text.
        const next = input.value.replace(/[\x00-\x1f\x7f-\xa0]/g, "").slice(0, w.maxlen);
        w.set(next);
        if (input.value !== next) input.value = next;
      });
      input.oninput = (event) => { if (!(event as InputEvent).isComposing) commit(); };
      input.addEventListener("compositionend", commit);
      this.element = field(w.label, input);
      this.element.style.setProperty("--label-width", `${w.label_w}px`);
      (this.element.firstElementChild as HTMLElement).style.flexBasis = `${w.label_w}px`;
      if (!w.label) (this.element.firstElementChild as HTMLElement).hidden = true;
      this.refresh = () => value(input, w.get());
    } else if (w instanceof W.Spinner || w instanceof W.Selector) {
      // Compact cycle/step controls keep the original < value > presentation.
      const group = el("span", "", "ui-stepper");
      const output = el("output");
      const adjust = (direction: number) => change(() => w instanceof W.Spinner ? w.adjust(direction) : w.cycle(direction));
      const previous = button("‹", () => adjust(-1));
      const next = button("›", () => adjust(1));
      previous.setAttribute("aria-label", `Decrease ${W.plain(label)}`);
      next.setAttribute("aria-label", `Increase ${W.plain(label)}`);
      group.setAttribute("role", "group"); group.setAttribute("aria-label", W.plain(label));
      group.append(previous, output, next);
      group.onkeydown = (event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); event.stopPropagation(); adjust(event.key === "ArrowLeft" ? -1 : 1); }
      };
      group.oncontextmenu = (event) => { event.preventDefault(); adjust(-1); };
      this.element = field(w.label, group); this.labelNode = this.element.firstElementChild as HTMLElement;
      this.labelNode.style.flexBasis = `${Math.min(144, Math.max(0, w.rect.w - 100))}px`;
      if (!w.label) this.labelNode.hidden = true;
      this.refresh = () => { output.textContent = w instanceof W.Spinner ? w.fmt(w.get()) : w.options[w.get_idx()]; };
    } else if (w instanceof W.Toggle) {
      const input = el("input"); input.type = "checkbox";
      const text = el("span"); this.labelNode = text;
      this.element = el("label"); this.element.append(input, text);
      input.onchange = () => change(() => w.set(input.checked));
      this.refresh = () => { input.checked = w.get(); };
    } else if (w instanceof W.Slider) {
      const input = el("input"); input.type = "range";
      input.min = "0"; input.max = String(w.values.length - 1); input.step = "1";
      input.setAttribute("aria-label", W.plain(label));
      input.oninput = () => change(() => w._set_index(Number(input.value)));
      this.element = field(w.label, input);
      if (!w.label) (this.element.firstElementChild as HTMLElement).hidden = true;
      this.refresh = () => { input.value = String(w._cur_index()); input.setAttribute("aria-valuetext", w.fmt(w.get())); };
    } else if (w instanceof W.RadioGroup) {
      this.element = el("div", "", "ui-radio");
      this.element.style.setProperty("--columns", String(w.cols));
      this.element.setAttribute("role", "radiogroup"); this.element.setAttribute("aria-label", label);
      const name = `ui-radio-${++nextGroup}`;
      const inputs = w.labels.map((text, i) => {
        const input = el("input"); input.type = "radio"; input.name = name;
        input.onchange = () => change(() => w.set_idx(i));
        const node = el("label"); const span = el("span"); caption(span, text);
        node.append(input, span); this.element.append(node);
        return input;
      });
      this.refresh = () => inputs.forEach((input, i) => { input.checked = w.get_idx() === i; });
    } else if (w instanceof W.IconStrip) {
      this.element = el("div", "", "ui-icons");
      this.element.setAttribute("role", "group"); this.element.setAttribute("aria-label", label);
      const labels = actions.iconLabels?.(w);
      const buttons = w.cells.map((cell, i) => {
        const node = button("", () => change(() => w.set_idx(i)));
        node.setAttribute("aria-label", labels?.[i] ?? `${label} ${i + 1}`);
        node.style.width = `${w.cell}px`; node.style.height = `${w.cell}px`;
        // Text-only category tabs are native HTML; sprites remain presentation assets.
        if (labels?.[i] === "Weapons" || labels?.[i] === "Miscellaneous") {
          node.textContent = labels[i] === "Miscellaneous" ? "Misc" : labels[i];
          node.style.fontSize = "12px";
        } else if (w.draw_cell) {
          const surface = new pg.Surface([w.cell - 2, w.cell - 2]); surface.fill(W.C_PANEL);
          w.draw_cell(surface, new pg.Rect(0, 0, w.cell - 2, w.cell - 2), i, cell);
          surface.canvas.setAttribute("aria-hidden", "true"); node.append(surface.canvas);
        } else node.textContent = String(i + 1);
        this.element.append(node); return node;
      });
      this.element.onkeydown = (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault(); event.stopPropagation();
        change(() => { const next = Math.max(0, Math.min(buttons.length - 1, w.get_idx() + (event.key === "ArrowLeft" ? -1 : 1))); w.set_idx(next); buttons[next]?.focus(); });
      };
      this.refresh = () => buttons.forEach((node, i) => node.setAttribute("aria-pressed", String(w.get_idx() === i)));
    } else if (w instanceof W.Frame && w.capture) {
      this.element = button("", () => change(() => { w.arming = true; }));
      this.element.classList.add("ui-capture");
      const title = el("span", W.plain(w.title), "ui-capture-title");
      const key = el("span");
      this.element.append(title, key);
      this.element.onkeydown = (event) => {
        if (!w.arming || event.isComposing) return;
        event.preventDefault(); event.stopPropagation();
        change(() => w.take_key({ type: pg.KEYDOWN, key: pg.keyToPygame(event), unicode: pg.unicodeFor(event) }));
      };
      this.refresh = () => { key.textContent = w.arming ? "press a key…" : String(w.get_key?.() ?? ""); };
    } else if (w instanceof W.Frame) {
      this.element = el("fieldset", "", "ui-group"); const legend = el("legend"); caption(legend, w.title); this.element.append(legend);
    } else {
      this.element = el("span"); this.labelNode = this.element;
      if (w instanceof W.Label) { if (Array.isArray(w.color)) this.element.style.color = `rgb(${w.color.slice(0, 3).join(",")})`; this.element.style.fontSize = `${w.size}px`; this.element.style.fontWeight = w.bold ? "bold" : "normal"; }
    }
    this.element.classList.add("ui-widget");
    if (w.accel) this.element.setAttribute("aria-keyshortcuts", w.accel);
    this.controls = Array.from(this.element.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button"));
    if (this.element instanceof HTMLButtonElement) this.controls.push(this.element);
    this.update(true);
  }
  update(active: boolean): void {
    const w = this.model;
    if (this.labelNode) caption(this.labelNode, w.label);
    for (const control of this.controls) control.disabled = !active || !w.enabled;
    this.element.setAttribute("aria-disabled", String(!active || !w.enabled));
    this.refresh();
  }
  dispose(): void { this.element.remove(); }
}

export class PanelView implements Component<boolean> {
  readonly element = el("section", "", "se-ui ui-compact ui-panel");
  readonly body = el("div", "", "ui-panel-body");
  readonly heading = el("h1", "", "ui-title");
  private views = new Map<W.Widget, WidgetView>();
  constructor(readonly model: W.Panel, private actions: WidgetActions) {
    this.element.append(this.heading, this.body);
    this.heading.id = `ui-panel-${++nextGroup}`;
    this.element.setAttribute("aria-labelledby", this.heading.id);
  }
  update(active: boolean): void {
    const p = this.model;
    this.heading.textContent = p.title || W.plain(p.widgets.find((w) => w instanceof W.Label && !w.clickable)?.label ?? "Controls");
    this.heading.hidden = !p.title;
    Object.assign(this.element.style, { left: `${p.rect.x}px`, top: `${p.rect.y}px`, width: `${p.rect.w}px`, height: `${p.rect.h}px` });
    this.body.style.height = `${p.rect.h - (p.title ? 24 : 4)}px`;
    const widgets = new Set(p.widgets);
    for (const [w, view] of this.views) if (!widgets.has(w)) { view.dispose(); this.views.delete(w); }
    p.widgets.forEach((w, i) => {
      let view = this.views.get(w);
      if (!view) {
        const previous = p.widgets[i - 1];
        const label = this.actions.label?.(w) ?? (W.plain(w.label || (previous instanceof W.Label ? previous.label : "")) || (w instanceof W.RadioGroup ? "Computer difficulty" : w instanceof W.Slider ? "Selection" : "Choose item"));
        view = new WidgetView(w, this.actions, label); this.views.set(w, view); this.body.append(view.element);
      }
      Object.assign(view.element.style, { left: `${w.rect.x - p.rect.x - 2}px`, top: `${w.rect.y - p.rect.y - (p.title ? 24 : 2)}px`, width: w instanceof W.Label && !w.clickable ? "max-content" : `${w.rect.w}px`, maxWidth: `${p.rect.right - w.rect.x - 8}px`, minHeight: `${w.rect.h}px` });
      view.update(active);
    });
  }
  hide(widget: W.Widget, hidden: boolean): void { const view = this.views.get(widget); if (view) view.element.hidden = hidden; }
  focusDefault(): void {
    const control = this.element.querySelector<HTMLElement>("[data-default]:not(:disabled)") ??
      this.element.querySelector<HTMLElement>("input:not(:disabled), button:not(:disabled)");
    control?.focus({ preventScroll: true });
  }
  dispose(): void { for (const view of this.views.values()) view.dispose(); this.views.clear(); this.element.remove(); }
}
