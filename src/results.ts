/** Presentation of earned cash; reading results never pays rewards. */
import { incomeTotal, roundIncome } from "./comeback";
import type { GameState } from "./game";
import type { Tank } from "./objects";

export function roundEarnings(state: Pick<GameState, "comeback" | "round_index" | "cfg">, tank: Pick<Tank, "player_index" | "cash" | "round_start_cash">): number | undefined {
  const income = roundIncome(state.comeback, tank.player_index, state.round_index < state.cfg.MAXROUNDS);
  if (income) return incomeTotal(income);
  // Older Classic saves lack the starting balance; do not invent a round total.
  return tank.round_start_cash === undefined ? undefined : tank.cash - tank.round_start_cash;
}
