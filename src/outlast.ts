/** Optional browser rule, not a reconstruction of DOS scoring. */
import { TEAM_NONE } from "./constants";
import type { Economy, EconomyTank } from "./economy";

export const OUTLAST_CASH = 500;

interface OutlastTank extends EconomyTank {
  player_index: number;
  team_id: number;
  alive: boolean;
}

/** A non-null tracker means the option was enabled when this round began. */
export interface OutlastRound {
  players: Array<{ player_index: number; amount: number; eliminated: boolean }>;
  paid: boolean;
}

export function startOutlastRound(tanks: OutlastTank[]): OutlastRound {
  return {
    players: tanks.map((t) => ({ player_index: t.player_index, amount: 0, eliminated: !t.alive })),
    paid: false,
  };
}

export function copyOutlastRound(round: OutlastRound): OutlastRound {
  return { players: round.players.map((p) => ({ ...p })), paid: round.paid };
}

/** Reconcile once per complete game update, so same-update deaths are tied. */
export function accrueOutlast(round: OutlastRound | null, tanks: OutlastTank[], teamMode: number): void {
  if (!round || round.paid) return;
  const byIndex = new Map(tanks.map((t) => [t.player_index, t]));
  const eliminated: OutlastTank[] = [];
  for (const p of round.players) {
    const tank = byIndex.get(p.player_index);
    if (tank && !tank.alive && !p.eliminated) {
      p.eliminated = true;
      eliminated.push(tank);
    }
  }
  for (const p of round.players) {
    const tank = byIndex.get(p.player_index);
    if (!tank?.alive || p.eliminated) continue;
    for (const victim of eliminated) {
      if (teamMode === TEAM_NONE || tank.team_id !== victim.team_id) p.amount += OUTLAST_CASH;
    }
  }
}

/** Pay earned cash even to eliminated players, without changing their score. */
export function payOutlast(round: OutlastRound | null, tanks: OutlastTank[], economy: Economy): void {
  if (!round || round.paid) return;
  round.paid = true;
  const byIndex = new Map(tanks.map((t) => [t.player_index, t]));
  for (const p of round.players) {
    const tank = byIndex.get(p.player_index);
    if (tank) economy.credit(tank, p.amount);
  }
}
