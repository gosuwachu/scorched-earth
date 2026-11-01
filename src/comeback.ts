/** Optional browser economy; these rules are not DOS scoring. */
import { TEAM_NONE } from "./constants";
import type { Economy, EconomyTank } from "./economy";
import type { ShopIncome } from "../shared/economy";

export const RESUPPLY_CASH = 5000;
export const RECOVERY_STEP = 500;
export const RECOVERY_CAP = 1500;

interface ComebackPlayer extends ShopIncome {
  player_index: number;
  losses: number;
}

/** Presence freezes Comeback mode for the match, independent of menu config. */
export interface ComebackMatch {
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
    players: tanks.map((t) => ({ player_index: t.player_index, losses: 0,
      resupply: 0, combat: 0, penalties: 0, recovery: 0 })),
    settled: true,
    paid: true,
  };
}

export function copyComeback(match: ComebackMatch): ComebackMatch {
  return { ...match, players: match.players.map((p) => ({ ...p })) };
}

export function beginComebackRound(match: ComebackMatch): void {
  match.settled = false;
  match.paid = false;
  for (const p of match.players) {
    p.resupply = p.combat = p.penalties = p.recovery = 0;
  }
}

/** Track actual cash changes, including penalties limited by the zero floor. */
export function recordCombatCash(match: ComebackMatch | null | undefined, playerIndex: number | undefined, amount: number): void {
  if (!match || match.settled) return;
  const p = match.players.find((p) => p.player_index === playerIndex);
  if (!p) return;
  if (amount < 0) p.penalties += amount;
  else p.combat += amount;
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
  match.paid = true;
  for (const p of match.players) {
    const tank = tanks.find((t) => t.player_index === p.player_index);
    if (!tank) continue;
    p.resupply = RESUPPLY_CASH;
    p.recovery = Math.min(RECOVERY_CAP, p.losses * RECOVERY_STEP);
    economy.credit(tank, p.resupply + p.recovery);
  }
}

export function shopIncome(match: ComebackMatch | null | undefined, playerIndex: number | undefined): ShopIncome | undefined {
  if (!match?.paid) return undefined;
  const p = match.players.find((p) => p.player_index === playerIndex);
  if (!p?.resupply) return undefined; // No breakdown in the initial shop.
  return { resupply: p.resupply, combat: p.combat, penalties: p.penalties, recovery: p.recovery };
}

export function incomeLines(income: ShopIncome): string[] {
  const cash = (n: number) => `${n < 0 ? "−" : "+"}$${Math.abs(n).toLocaleString("en-US")}`;
  return [
    `Resupply ${cash(income.resupply)}`,
    `Combat earnings ${cash(income.combat)}`,
    `Penalties ${cash(income.penalties)}`,
    `Recovery bonus ${cash(income.recovery)}`,
  ];
}
