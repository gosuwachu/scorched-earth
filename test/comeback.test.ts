/** Browser economy acceptance cases, not DOS fidelity fixtures. */
import { describe, expect, it, vi } from "vitest";
import { Config } from "../src/config";
import { createGameState, type GameState } from "../src/game";
import { shopIncome } from "../src/comeback";
import * as scoring from "../src/scoring";
import { apply, load, save, serialize, type SaveGameState } from "../src/savegame";
import { ShopScreen } from "../src/screens";
import { RemoteAdapter } from "../src/remote";
import type { App } from "../src/main";
import type { Player } from "../shared/online";
import { SLOT_AUTO_DEFENSE } from "../src/weapons";

function game(n = 2, overrides: Partial<Config> = {}): GameState {
  const cfg = Object.assign(new Config(), { ECONOMY_MODE: "COMEBACK", INITIAL_CASH: 0,
    MAXROUNDS: 10, MAX_WIND: 0, SKY: "PLAIN", SOUND: "OFF", TALKING_TANKS: "OFF",
    FALLING_TANKS: "OFF", ...overrides });
  const gs = createGameState(cfg, 320, 200, 123);
  for (let i = 0; i < n; i++) gs.add_player(`Player ${i}`, 0, i % 2);
  gs.new_game();
  return gs;
}

function finish(gs: GameState, survivors = [0]): void {
  gs.tanks.forEach((t, i) => { t.alive = survivors.includes(i); });
  gs._end_round();
}

function saveView(gs: GameState): SaveGameState {
  return { ...gs, terrain: { grid: { w: gs.w, h: gs.h, data: gs.terrain.grid } } } as unknown as SaveGameState;
}

function restore(gs: GameState, bytes: Uint8Array): void {
  const view = apply(load(bytes), saveView(gs));
  gs.terrain.grid = view.terrain.grid.data;
  Object.assign(gs, view, { terrain: gs.terrain });
}

describe("Comeback economy", () => {
  it("defaults to Classic and persists the explicit choice", () => {
    expect(Config.load("").ECONOMY_MODE).toBe("CLASSIC");
    for (const mode of ["CLASSIC", "COMEBACK"]) {
      const cfg = Object.assign(new Config(), { ECONOMY_MODE: mode });
      expect(Config.load(cfg.save()).ECONOMY_MODE).toBe(mode);
    }
  });

  it("counts all four non-winners as losing in a five-player round", () => {
    const gs = game(5);
    finish(gs, [2]);
    expect(gs.comeback!.players.map((p) => p.losses)).toEqual([1, 1, 0, 1, 1]);
    expect(gs.tanks.map((t) => t.cash)).toEqual([0, 0, 5000, 0, 0]);
    gs.proceed_after_round();
    expect(gs.tanks.map((t) => t.cash)).toEqual([5500, 5500, 10000, 5500, 5500]);
    expect(gs.tanks.map((t) => t.score)).toEqual([0, 0, 5000, 0, 0]);
    expect(gs.tanks.map((t) => t.win_counter)).toEqual([0, 0, 1, 0, 0]);
  });

  it("keeps full combat rewards and records the agreed duel example", () => {
    const gs = game();
    scoring.award_hit(gs, gs.tanks[0], gs.tanks[1], 100, false);
    scoring.award_kill(gs, gs.tanks[0], gs.tanks[1]);
    finish(gs);
    gs.proceed_after_round();
    expect(gs.tanks.map((t) => t.cash)).toEqual([13500, 5500]);
    expect(gs.tanks.map((t) => t.score)).toEqual([8500, 0]);
    expect(shopIncome(gs.comeback, 0)).toEqual({ resupply: 5000, combat: 8500, penalties: 0, recovery: 0 });
    expect(shopIncome(gs.comeback, 1)).toEqual({ resupply: 5000, combat: 0, penalties: 0, recovery: 500 });
  });

  it("preserves Basic scoring amounts", () => {
    const gs = game(5, { SCORING: "BASIC" });
    scoring.award_hit(gs, gs.tanks[0], gs.tanks[1], 100, false);
    scoring.award_kill(gs, gs.tanks[0], gs.tanks[1]);
    finish(gs); gs.proceed_after_round();
    expect(gs.tanks[0].score).toBe(9000);
    expect(gs.tanks[0].cash).toBe(14000);
  });

  it("caps recovery after three losses and resets it on a win and a new match", () => {
    const gs = game();
    for (const recovery of [500, 1000, 1500, 1500]) {
      finish(gs); gs.proceed_after_round();
      expect(shopIncome(gs.comeback, 1)?.recovery).toBe(recovery);
      gs.begin_next_round();
    }
    finish(gs, [1]); gs.proceed_after_round();
    expect(gs.comeback!.players.map((p) => p.losses)).toEqual([1, 0]);
    expect(shopIncome(gs.comeback, 1)?.recovery).toBe(0);
    gs.new_game();
    expect(gs.comeback!.players.map((p) => p.losses)).toEqual([0, 0]);
    expect(gs.tanks.map((t) => t.cash)).toEqual([0, 0]);
  });

  it("credits eliminated teammates with the team's win", () => {
    const gs = game(4, { TEAM_MODE: "STANDARD" });
    gs.comeback!.players.forEach((p) => { p.losses = 2; });
    finish(gs, [2]); gs.proceed_after_round();
    expect(gs.comeback!.players.map((p) => p.losses)).toEqual([0, 3, 0, 3]);
    expect(gs.tanks.map((t) => t.cash)).toEqual([7500, 6500, 10000, 6500]);
  });

  it.each([false, true])("preserves streaks on a draw or administrative end (mass kill: %s)", (massKill) => {
    const gs = game();
    gs.comeback!.players[0].losses = 2;
    if (massKill) gs.mass_kill(); else finish(gs, []);
    gs.proceed_after_round();
    expect(gs.comeback!.players.map((p) => p.losses)).toEqual([2, 0]);
    expect(shopIncome(gs.comeback, 0)?.recovery).toBe(1000);
    expect(shopIncome(gs.comeback, 1)?.recovery).toBe(0);
  });

  it("keeps penalties and reports actual deductions when cash floors at zero", () => {
    const gs = game(2, { INITIAL_CASH: 1000 });
    gs.begin_next_round();
    scoring.award_kill(gs, gs.tanks[0], gs.tanks[0]);
    expect(gs.tanks[0].cash).toBe(0);
    expect(gs.tanks[0].score).toBe(-1500);
    finish(gs, [1]); gs.proceed_after_round();
    expect(shopIncome(gs.comeback, 0)).toEqual({ resupply: 5000, combat: 0, penalties: -1000, recovery: 500 });
    expect(gs.tanks[0].cash).toBe(5500);
  });

  it("keeps friendly-fire penalties at full strength", () => {
    const gs = game(4, { INITIAL_CASH: 10000, TEAM_MODE: "STANDARD" });
    gs.begin_next_round();
    scoring.award_hit(gs, gs.tanks[0], gs.tanks[2], 100, false);
    scoring.award_kill(gs, gs.tanks[0], gs.tanks[2]);
    expect(gs.tanks[0].cash).toBe(6500);
    expect(gs.tanks[0].score).toBe(-3500);
  });

  it("skips initial and final resupply and preserves carried equipment", () => {
    const gs = game(2, { INITIAL_CASH: 10000, MAXROUNDS: 1 });
    expect(shopIncome(gs.comeback, 0)).toBeUndefined();
    gs.proceed_after_round(); // An initial shop must not trigger a payout.
    expect(gs.tanks[0].cash).toBe(10000);
    gs.tanks[0].inventory[1] = 5;
    gs.begin_next_round();
    expect(gs.tanks[0].inventory[1]).toBe(5);
    finish(gs); gs.proceed_after_round(); gs.proceed_after_round();
    expect(gs.phase).toBe("game_over");
    expect(gs.tanks.map((t) => t.cash)).toEqual([15000, 10000]);
    expect(gs.winner).toBe(gs.tanks[0]);
    expect(shopIncome(gs.comeback, 0)).toBeUndefined();
  });

  it("disables Outlast and cash interest while retaining Auto Defense prices", () => {
    const gs = game(2, { OUTLAST_BONUS: "ON", INTEREST_RATE: 0.3 });
    expect(gs.outlast).toBeNull();
    finish(gs); gs.proceed_after_round();
    expect(gs.tanks.map((t) => t.cash)).toEqual([10000, 5500]);
    expect(gs.economy.price[SLOT_AUTO_DEFENSE]).toBe(gs.economy.annuity_price(SLOT_AUTO_DEFENSE, 8));
    expect(gs.cfg.INTEREST_RATE).toBe(0.3);
  });

  it.each(["CLASSIC", "COMEBACK"])("freezes %s mode until a new match", (mode) => {
    const gs = game(2, { ECONOMY_MODE: mode, SCORING: "GREEDY" });
    expect(gs.cfg.SCORING).toBe(mode === "COMEBACK" ? "STANDARD" : "GREEDY");
    gs.cfg.ECONOMY_MODE = mode === "CLASSIC" ? "COMEBACK" : "CLASSIC";
    finish(gs); gs.proceed_after_round();
    expect(gs.tanks.map((t) => t.cash)).toEqual(mode === "COMEBACK" ? [10000, 5500] : [5775, 0]);
    gs.new_game();
    expect(!!gs.comeback).toBe(mode === "CLASSIC");
  });

  it("does not repeat scoring, streaks, payments, or market updates", () => {
    const gs = game();
    const market = vi.spyOn(gs.economy, "market_update");
    finish(gs); finish(gs); gs.mass_kill();
    expect(gs.round_index).toBe(1);
    gs.proceed_after_round(); gs.proceed_after_round(); finish(gs);
    expect(gs.tanks.map((t) => t.cash)).toEqual([10000, 5500]);
    expect(gs.comeback!.players.map((p) => p.losses)).toEqual([0, 1]);
    expect(market).toHaveBeenCalledTimes(1);
  });
});

describe("Comeback persistence and controller state", () => {
  it.each(["battle", "rankings", "shop"])("restores %s without losing earnings or duplicating payment", (phase) => {
    const gs = game();
    scoring.award_hit(gs, gs.tanks[0], gs.tanks[1], 100, false);
    if (phase !== "battle") finish(gs);
    if (phase === "shop") gs.proceed_after_round();
    const view = saveView(gs);
    expect(load(save(view))).toEqual(serialize(view));
    const other = game(); restore(other, save(view));
    expect(other.comeback).toEqual(gs.comeback);
    expect(other.comeback!.players[0]).not.toBe(gs.comeback!.players[0]);
    if (phase === "battle") finish(other);
    other.proceed_after_round(); other.proceed_after_round();
    expect(other.tanks.map((t) => t.cash)).toEqual([13000, 5500]);
    expect(shopIncome(other.comeback, 0)?.combat).toBe(8000);
    other.begin_next_round(); finish(other); other.proceed_after_round();
    expect(shopIncome(other.comeback, 0)?.combat).toBe(5000);
    expect(shopIncome(other.comeback, 1)?.recovery).toBe(1000);
  });

  it("restores old saves as Classic even over an active Comeback match", () => {
    const old = game(2, { ECONOMY_MODE: "CLASSIC" });
    const data = serialize(saveView(old));
    delete data.cfg.ECONOMY_MODE; delete data.comeback;
    const gs = game();
    const view = apply(data, saveView(gs));
    gs.terrain.grid = view.terrain.grid.data;
    Object.assign(gs, view, { terrain: gs.terrain });
    expect(gs.comeback).toBeNull();
    expect(gs.cfg.ECONOMY_MODE).toBe("CLASSIC");
    finish(gs); gs.proceed_after_round();
    expect(gs.tanks.map((t) => t.cash)).toEqual([5775, 0]);
  });

  it("reports each guest's own payout, including waiting and reconnecting players", () => {
    const gs = game(); finish(gs); gs.proceed_after_round();
    const top = Object.assign(Object.create(ShopScreen.prototype), {
      tank: gs.tanks[0], state: gs, panel: { widgets: [] }, items: [], category: 0,
    });
    const app = { gs, top, onlineScreen: "shop", onlineMenuOpen: false, transitioning: false };
    const roster: Player[] = gs.tanks.map((t) => ({ id: t.name, name: t.name, icon: 0,
      colorIndex: t.player_index, ai: 0, ready: true, connected: true }));
    const adapter = new RemoteAdapter(app as unknown as App, roster);
    const states = adapter.states(roster);
    for (const t of gs.tanks) expect(states[t.name].income).toEqual(shopIncome(gs.comeback, t.player_index));
    roster[1].connected = false; adapter.states(roster);
    roster[1].connected = true;
    expect(adapter.states(roster)[roster[1].id].income).toEqual(states[roster[1].id].income);
    expect(gs.tanks.map((t) => t.cash)).toEqual([10000, 5500]);
  });
});
