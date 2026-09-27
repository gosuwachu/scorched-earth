/** Shared, framework-free HTML controls. No game-state dependencies. */
import { C_BG, C_PANEL, C_PANEL_HI, C_PANEL_LO, C_TEXT, C_TEXT_LT, C_ACCEL, C_SEL, C_FIELD } from "./theme";
import { animateDialog } from "./transitions";
import "./theme.css";

export interface Component<T = void> {
  element: HTMLElement;
  update(value: T): void;
  dispose(): void;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
}

/** Share the canvas widget palette instead of maintaining a second UI theme. */
export function installTheme(): void {
  const colors = { bg: C_BG, panel: C_PANEL, hi: C_PANEL_HI, lo: C_PANEL_LO,
    text: C_TEXT, title: C_TEXT_LT, accel: C_ACCEL, selection: C_SEL, field: C_FIELD };
  for (const [name, rgb] of Object.entries(colors)) {
    document.documentElement.style.setProperty(`--ui-${name}`, `rgb(${rgb.join(", ")})`);
  }
}

export function button(label: string, action: () => void, shortcut?: string): HTMLButtonElement {
  const b = el("button", label);
  b.type = "button";
  b.onclick = action;
  if (shortcut) {
    const index = label.toLowerCase().indexOf(shortcut.toLowerCase());
    if (index >= 0) b.replaceChildren(label.slice(0, index), el("span", label[index], "ui-accel"), label.slice(index + 1));
    b.setAttribute("aria-keyshortcuts", shortcut);
  }
  return b;
}

export interface Dialog {
  element: HTMLDialogElement;
  body: HTMLElement;
  footer: HTMLElement;
  close(done?: () => void): void;
  dispose(): void;
  update(title: string): void;
}

let nextDialogId = 0;

/** Common native dialog shell used by both game screens and online dialogs. */
export function modalShell(options: { className?: string; cancel?: () => void } = {}): HTMLDialogElement {
  const element = el("dialog", "", `se-ui ${options.className ?? ""}`);
  element.dataset.uiOwner = "true";
  element.addEventListener("cancel", (event) => { event.preventDefault(); options.cancel?.(); });
  return element;
}

/** Native modal behavior supplies an inert background and Escape handling. */
export function dialog(title: string, options: { cancel?: () => void; parent?: HTMLElement; className?: string; sound?: () => boolean } = {}): Dialog {
  let animation: Animation | null = null;
  let closing = false;
  let disposed = false;
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const element = modalShell({ className: "ui-dialog", cancel: () => { if (!closing) options.cancel?.(); } });
  // Like settings, the first action during an opening wipe only completes it.
  const guard = (event: Event) => {
    if (event instanceof KeyboardEvent && (event.key === "F11" || (event.altKey && event.key === "Enter"))) return;
    if (!closing && !animation) return;
    event.preventDefault(); event.stopImmediatePropagation();
    animation?.finish();
  };
  element.addEventListener("keydown", guard, true);
  element.addEventListener("click", guard, true);
  const heading = el("h1", title, "ui-title");
  heading.id = `ui-dialog-${++nextDialogId}`;
  element.setAttribute("aria-labelledby", heading.id);
  const body = el("div", "", "ui-dialog-body");
  const footer = el("footer", "", "ui-dialog-footer");
  element.append(heading, body, footer);
  if (options.className) element.classList.add(...options.className.split(" "));
  element.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const visible = Array.from(element.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex='0']"))
      .filter((node) => node.getClientRects().length > 0);
    // Native radio groups contribute one Tab stop: the selected (or first) input.
    const controls = visible.filter((node) => {
      if (!(node instanceof HTMLInputElement) || node.type !== "radio" || !node.name) return true;
      const group = visible.filter((other): other is HTMLInputElement => other instanceof HTMLInputElement && other.type === "radio" && other.name === node.name && other.form === node.form);
      return node === (group.find((input) => input.checked) ?? group[0]);
    });
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === element)) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  });
  (options.parent ?? document.body).append(element);
  element.showModal();
  animation = animateDialog(element, true, options.sound?.() ?? false, () => { animation = null; });
  queueMicrotask(() => {
    if (element.isConnected && document.activeElement === element) element.querySelector<HTMLElement>("button:not(:disabled), input, select")?.focus();
  });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (animation) {
      animation.onfinish = animation.oncancel = null;
      animation.cancel(); animation = null;
    }
    element.close(); element.remove();
    if (returnFocus?.isConnected && !returnFocus.closest("[inert], [hidden]")) returnFocus.focus({ preventScroll: true });
  };
  const close = (done?: () => void) => {
    if (closing || disposed) return;
    closing = true; element.inert = true;
    if (animation) {
      animation.onfinish = animation.oncancel = null;
      animation.cancel();
    }
    animation = animateDialog(element, false, options.sound?.() ?? false, () => { dispose(); done?.(); });
  };
  return { element, body, footer, close, dispose, update: (title) => { heading.textContent = title; } };
}

/** Set a property only when it changes, preserving native input selection. */
export function value(input: HTMLInputElement | HTMLSelectElement, next: string): void {
  if (input.value !== next && document.activeElement !== input) input.value = next;
}

export function caption(node: HTMLElement, label: string): void {
  if (node.dataset.caption === label) return;
  node.dataset.caption = label;
  const i = label.indexOf("~");
  node.replaceChildren(...(i >= 0 ? [label.slice(0, i), el("span", label[i + 1] ?? "", "ui-accel"), label.slice(i + 2)] : [label]));
}

export function field(label: string, input: HTMLElement): HTMLLabelElement {
  const node = el("label", "", "ui-field");
  const text = el("span");
  caption(text, label);
  node.append(text, input);
  return node;
}

/** Stable keyed rows; updates never detach an unchanged focused row. */
export class KeyedList<T> implements Component<readonly T[]> {
  readonly element: HTMLElement;
  private rows = new Map<string, HTMLElement>();
  constructor(tag: "div" | "ul" | "tbody", private key: (item: T) => string,
    private create: (item: T) => HTMLElement, private render: (row: HTMLElement, item: T, index: number) => void) {
    this.element = el(tag);
  }
  update(items: readonly T[]): void {
    const keys = new Set(items.map(this.key));
    for (const [key, row] of this.rows) if (!keys.has(key)) {
      if (row.contains(document.activeElement)) this.element.focus({ preventScroll: true });
      row.remove(); this.rows.delete(key);
    }
    items.forEach((item, i) => {
      const key = this.key(item);
      let row = this.rows.get(key);
      if (!row) { row = this.create(item); this.rows.set(key, row); }
      this.render(row, item, i);
      if (this.element.children[i] !== row) this.element.insertBefore(row, this.element.children[i] ?? null);
    });
  }
  dispose(): void { this.rows.clear(); this.element.remove(); }
}
