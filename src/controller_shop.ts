import type { Control, ControllerView } from "../shared/online";
import { button, el } from "./html/components";
import { TankOverview } from "./controller_frame";

/** Guest shop presentation; purchases remain authoritative on the host. */
export class ShopControls {
  readonly element = el("section", "", "lan-shop");
  readonly list = el("div", "", "lan-shop-list lan-controls");
  readonly actions = el("div", "", "lan-shop-actions lan-controls");
  private equipment = el("div", "", "lan-shop-equipment");
  private overview = new TankOverview();
  private empty = el("p", "No equipment available in this category", "lan-shop-empty");
  private categories: HTMLButtonElement[];
  private category?: number | boolean;
  private categoryDisabled = true;

  constructor(selectCategory: (value: number) => void) {
    this.element.setAttribute("aria-label", "Purchasing");
    this.element.hidden = true;
    this.overview.cash.classList.add("lan-shop-cash");
    const categories = el("div", "", "lan-shop-categories");
    categories.setAttribute("role", "group");
    categories.setAttribute("aria-label", "Category");
    this.categories = ["Weapons", "Miscellaneous"].map((label, index) => button(label, () => selectCategory(index)));
    categories.append(...this.categories);
    this.list.tabIndex = 0;
    this.list.setAttribute("role", "group");
    this.list.setAttribute("aria-label", "Available equipment");
    this.equipment.append(el("h2", "Purchasing"), categories,
      el("p", "Tap an item to buy one bundle.", "lan-shop-hint"), this.empty, this.list, this.actions);
    this.element.append(this.overview.element, this.equipment);
  }

  update(view: ControllerView, playerIndex: number): void {
    const tank = view.tank;
    if (tank) this.overview.update(tank, playerIndex, view.round, false);
    const category = view.controls.find((c) => c.id === "category");
    this.equipment.hidden = !view.enabled || !category;
    this.categoryDisabled = !category || !!category.disabled;
    if (category) {
      if (this.category !== category.value) this.list.scrollTop = 0;
      this.category = category.value;
      this.categories.forEach((node, index) => node.setAttribute("aria-pressed", String(index === category.value)));
    }
    this.empty.hidden = !view.enabled || view.controls.some((c) => c.purchase);
  }

  setEnabled(enabled: boolean): void {
    for (const node of this.categories) node.disabled = !enabled || this.categoryDisabled;
  }

  target(control: Control): HTMLElement {
    return control.purchase ? this.list : this.actions;
  }
}
