import type { Config } from "../config";
import { incomeLines } from "../comeback";
import type { ShopIncome } from "../../shared/economy";
import { el, field } from "./components";
import { describeOption } from "./option_help";

let nextEconomyHelp = 0;

/** Shared pre-match choice for local setup and the online host lobby. */
export function economyChoice(cfg: Config): { element: HTMLElement; select: HTMLSelectElement } {
  const select = el("select");
  for (const [value, label] of [["CLASSIC", "Classic"], ["COMEBACK", "Comeback"]]) {
    const option = el("option", label); option.value = value; select.append(option);
  }
  select.value = cfg.ECONOMY_MODE.toUpperCase() === "COMEBACK" ? "COMEBACK" : "CLASSIC";
  const help = el("p", "", "ui-option-help");
  help.id = `economy-help-${++nextEconomyHelp}`;
  select.setAttribute("aria-describedby", help.id);
  const refresh = () => { help.textContent = describeOption("ECONOMY_MODE", select.value) ?? ""; };
  select.onchange = () => {
    cfg.ECONOMY_MODE = select.value;
    if (select.value === "COMEBACK" && cfg.SCORING.toUpperCase() === "GREEDY") cfg.SCORING = "STANDARD";
    refresh();
  };
  refresh();
  const element = el("div"); element.append(field("Economy", select), help);
  return { element, select };
}

/** Same labels and amounts on the local shop and remote controller. */
export class IncomeBreakdown {
  readonly element = el("section", "", "ui-income");
  private rows = Array.from({ length: 4 }, () => el("div"));
  private total = el("strong");

  constructor() {
    this.element.setAttribute("aria-label", "Round income");
    this.element.append(el("strong", "Round income"), ...this.rows, this.total);
    this.element.hidden = true;
  }

  update(income: ShopIncome | undefined): void {
    this.element.hidden = !income;
    if (!income) return;
    incomeLines(income).forEach((line, i) => { this.rows[i].textContent = line; });
    const total = income.resupply + income.combat + income.penalties + income.recovery;
    this.total.textContent = `Total ${total < 0 ? "−" : "+"}$${Math.abs(total).toLocaleString("en-US")}`;
  }
}
