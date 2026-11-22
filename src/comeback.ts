/** Optional browser economy; these rules are not DOS scoring. */
import { TEAM_NONE } from "./constants";
import type { Economy, EconomyTank } from "./economy";
import type { ShopIncome } from "../shared/economy";

export const RESUPPLY_CASH = 7500;
export const VICTORY_CASH = 7500;
export const KILL_CASH = 1000;
export const RECOVERY_STEP = 500;
export const RECOVERY_CAP = 1500;

interface ComebackPlayer extends ShopIncome {
  player_index: number;
  losses: number;
  /** Unscaled positive damage/kill cash this round; retained through saves. */
  combat_base: number;
}

/** Presence freezes Comeback mode for the match, independent of menu config. */
export interface ComebackMatch {
  /** Missing on older saves, which retain the original Comeback rules. */
  version?: 2;
  players: ComebackPlayer[];
  settled: boolean;
  paid: boolean;
}

interface ComebackTank extends EconomyTank {
  player_index: number;
  team_id: number;
  alive: boolean;
}

export function createComeback(tanks: ComebackTank[]): ComebackMatch {
  return {
    version: 2,
    players: tanks.map((t) => ({ player_index: t.player_index, losses: 0,
      combat_base: 0, resupply: 0, combat: 0, victory: 0, penalties: 0, recovery: 0 })),
    settled: true,
    paid: true,
  };
}

export function copyComeback(match: ComebackMatch): ComebackMatch {
  return { ...match, players: match.players.map((p) => ({ ...p,
    combat_base: p.combat_base ?? 0, victory: p.victory ?? 0 })) };
}

/** Cash-only browser rules; presence alone still identifies legacy Comeback. */
export function scaledComeback(match: ComebackMatch | null | undefined): match is ComebackMatch {
  return match?.version === 2;
}

/** Pay increments of the rounded round total, independent of damage packet size. */
export function combatCash(match: ComebackMatch, playerIndex: number | undefined, base: number): number {
  const p = match.players.find((p) => p.player_index === playerIndex);
  if (!p || match.settled) return 0;
  const denominator = Math.max(1, match.players.length - 1);
  const previous = Math.round(3 * p.combat_base / denominator);
  p.combat_base += base;
  return Math.round(3 * p.combat_base / denominator) - previous;
}

export function beginComebackRound(match: ComebackMatch): void {
  match.settled = false;
  match.paid = false;
  for (const p of match.players) {
    p.combat_base = p.resupply = p.combat = p.victory = p.penalties = p.recovery = 0;
  }
}

/** Track actual cash changes, including penalties limited by the zero floor. */
export function recordCombatCash(match: ComebackMatch | null | undefined, playerIndex: number | undefined, amount: number, kind: "combat" | "victory" = "combat"): void {
  if (!match || match.settled) return;
  const p = match.players.find((p) => p.player_index === playerIndex);
  if (!p) return;
  if (amount < 0) p.penalties += amount;
  else p[kind] += amount;
}

export function finishComebackRound(match: ComebackMatch, tanks: ComebackTank[], teamMode: number, administrative = false): void {
  if (match.settled) return;
  match.settled = true;
  const alive = tanks.filter((t) => t.alive);
  // No survivor is a draw. An administrative end never changes streaks.
  if (administrative || alive.length === 0) return;
  const winner = alive[0];
  const winners = teamMode === TEAM_NONE ? new Set([winner.player_index]) :
    new Set(tanks.filter((t) => t.team_id === winner.team_id).map((t) => t.player_index));
  for (const p of match.players) p.losses = winners.has(p.player_index) ? 0 : p.losses + 1;
}

export function payComeback(match: ComebackMatch, tanks: ComebackTank[], economy: Economy): void {
  if (!match.settled || match.paid) return;
  for (const p of match.players) {
    const tank = tanks.find((t) => t.player_index === p.player_index);
    if (!tank) continue;
    const income = roundIncome(match, p.player_index, true)!;
    p.resupply = income.resupply;
    p.recovery = income.recovery;
    economy.credit(tank, p.resupply + p.recovery);
  }
  match.paid = true;
}

/** Preview the settled round, including assistance due before the next shop.
 * Reading results must never credit cash or change the payment guard. */
export function roundIncome(match: ComebackMatch | null | undefined, playerIndex: number | undefined, nextShop: boolean): ShopIncome | undefined {
  if (!match?.settled) return undefined;
  const p = match.players.find((p) => p.player_index === playerIndex);
  if (!p) return undefined;
  return {
    resupply: match.paid ? p.resupply : nextShop ? (scaledComeback(match) ? RESUPPLY_CASH : 5000) : 0,
    combat: p.combat,
    victory: p.victory ?? 0,
    penalties: p.penalties,
    recovery: match.paid ? p.recovery : nextShop ? Math.min(RECOVERY_CAP, p.losses * RECOVERY_STEP) : 0,
  };
}

export function incomeTotal(income: ShopIncome): number {
  return income.resupply + income.combat + (income.victory ?? 0) + income.penalties + income.recovery;
}

export function shopIncome(match: ComebackMatch | null | undefined, playerIndex: number | undefined): ShopIncome | undefined {
  if (!match?.paid) return undefined;
  const p = match.players.find((p) => p.player_index === playerIndex);
  if (!p?.resupply) return undefined; // No breakdown in the initial shop.
  return { resupply: p.resupply, combat: p.combat, victory: p.victory, penalties: p.penalties, recovery: p.recovery };
}

export function incomeLines(income: ShopIncome): string[] {
  const cash = (n: number) => `${n < 0 ? "−" : "+"}$${Math.abs(n).toLocaleString("en-US")}`;
  return [
    `Resupply ${cash(income.resupply)}`,
    `Combat earnings ${cash(income.combat)}`,
    `Victory ${cash(income.victory ?? 0)}`,
    `Penalties ${cash(income.penalties)}`,
    `Recovery bonus ${cash(income.recovery)}`,
  ];
}
