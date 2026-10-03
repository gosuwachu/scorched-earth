import type { Control, ControllerView } from "../shared/online";
import { el } from "./html/components";
import { TankOverview } from "./controller_frame";

/** Equipment, inventory and prompts share the same scrollable guest frame. */
export class PanelControls {
  readonly element = el("section", "", "lan-panel");
  readonly heading = el("h2");
  readonly body = el("div", "", "lan-panel-content");
  readonly footer = el("div", "", "lan-panel-footer lan-controls");
  readonly escape = el("div", "", "lan-panel-escape");
  readonly targetKeys = el("div", "", "lan-target-directions");
  private targetPosition = el("section", "", "lan-panel-group lan-target-position");
  private targetReadouts = el("div", "", "lan-target-readouts");
  private overview = new TankOverview();
  private content = el("div", "", "lan-panel-main");
  private groups = new Map<string, { element: HTMLElement; controls: HTMLElement }>();

  constructor() {
    this.element.hidden = true;
    this.heading.tabIndex = -1;
    this.heading.id = "lan-panel-heading";
    this.element.setAttribute("aria-labelledby", this.heading.id);
    this.targetPosition.setAttribute("aria-label", "Target position");
    this.targetKeys.setAttribute("role", "group");
    this.targetKeys.setAttribute("aria-label", "Target movement");
    this.targetPosition.append(this.targetReadouts, this.targetKeys);
    this.targetPosition.hidden = true;
    this.body.append(this.targetPosition);
    this.content.append(this.heading, this.body, this.footer, this.escape);
    this.element.append(this.overview.element, this.content);
  }

  target(control: Control): HTMLElement {
    if (control.presentation?.footer) return this.footer;
    if (control.kind === "readout") return this.targetReadouts;
    const section = control.presentation?.section ?? "";
    let group = this.groups.get(section);
    if (!group) {
      const element = el("section", "", "lan-panel-group");
      const controls = el("div", "", "lan-controls");
      if (section) {
        element.append(el("h3", section));
        element.setAttribute("aria-label", section);
      }
      element.append(controls);
      group = { element, controls };
      this.groups.set(section, group);
      this.body.append(element);
    }
    return group.controls;
  }

  update(view: ControllerView, playerIndex: number): void {
    this.heading.textContent = view.targeting ? "Choose target" : view.batteryPrompt ? "Discharge batteries" :
      view.controls.some((c) => c.id === "plasma-charge") ? "Charge Plasma" : view.screen;
    if (view.tank) this.overview.update(view.tank, playerIndex, view.round, view.screen !== "Inventory", view.screen === "Tank controls");
    this.overview.element.hidden = !view.tank;
    this.targetPosition.hidden = !view.enabled || !view.targeting;
    let index = 1; // The persistent target-position section precedes the ordinary groups.
    const sections = new Set(view.controls.filter((c) => !c.presentation?.footer && c.kind !== "readout").map((c) => c.presentation?.section ?? ""));
    for (const section of sections) {
      const group = this.groups.get(section);
      if (group && this.body.children[index] !== group.element) this.body.insertBefore(group.element, this.body.children[index] ?? null);
      index++;
    }
    for (const [section, group] of this.groups) group.element.hidden = !view.enabled || !sections.has(section);
    this.body.hidden = !view.enabled || (!sections.size && !view.targeting);
    this.footer.hidden = !view.enabled || !this.footer.children.length;
  }
}
