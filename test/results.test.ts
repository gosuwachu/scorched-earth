/** Browser results UI bookkeeping, not DOS fidelity expectations. */
import { describe, expect, it } from "vitest";
import { Config } from "../src/config";
import { createGameState, type GameState } from "../src/game";
import { incomeTotal, roundIncome, shopIncome } from "../src/comeback";
import { roundEarnings } from "../src/results";
import { award_hit, award_kill } from "../src/scoring";
import { apply, load, save, serialize, type SaveGameState } from "../src/savegame";

function game(mode = "COMEBACK", rounds = 3): GameState {
  const cfg = Object.assign(new Config(), { ECONOMY_MODE: mode, SCORING: "STANDARD", INITIAL_CASH: 10000,
    MAXROUNDS: rounds, MAX_WIND: 0, SKY: "PLAIN", SOUND: "OFF", TALKING_TANKS: "OFF",
    FALLING_TANKS: "OFF", OUTLAST_BONUS: "OFF" });
  const gs = createGameState(cfg, 320, 200, 123);
  gs.add_player("Winner", 0, 0); gs.add_player("Recovering", 0, 1);
  gs.new_game(); gs.begin_next_round();
  return gs;
}

function finish(gs: GameState): void {
  award_hit(gs, gs.tanks[0], gs.tanks[1], 100, false);
  award_kill(gs, gs.tanks[0], gs.tanks[1]);
  gs.tanks[1].alive = false; gs._end_round();
}

function view(gs: GameState): SaveGameState {
  return { ...gs, terrain: { grid: { w: gs.w, h: gs.h, data: gs.terrain.grid } } } as unknown as SaveGameState;
}

describe("round results income", () => {
  it("previews assistance without crediting it, then matches the next shop exactly", () => {
    const gs = game(); finish(gs);
    const before = serialize(view(gs));
    for (let i = 0; i < 3; i++) expect(gs.tanks.map(t => roundEarnings(gs, t))).toEqual([27000, 8000]);
    expect(serialize(view(gs))).toEqual(before);
    expect(gs.tanks.map(t => t.score)).toEqual([8500, 0]);
    expect(gs.tanks.map(t => t.cash)).toEqual([29500, 10000]);
    gs.proceed_after_round();
    expect(gs.tanks.map(t => incomeTotal(shopIncome(gs.comeback, t.player_index)!))).toEqual([27000, 8000]);
    expect(gs.tanks.map(t => roundEarnings(gs, t))).toEqual([27000, 8000]);
    expect(gs.tanks.map(t => t.cash)).toEqual([37000, 18000]);
  });

  it("shows only combat and victory in the final round", () => {
    const gs = game("COMEBACK", 1); finish(gs);
    expect(gs.tanks.map(t => roundEarnings(gs, t))).toEqual([19500, 0]);
    expect(roundIncome(gs.comeback, 1, false)).toMatchObject({ recovery: 0, resupply: 0 });
    gs.proceed_after_round();
    expect(gs.tanks.map(t => t.cash)).toEqual([29500, 10000]);
  });

  it("preserves administrative recovery and reports net earnings after penalties", () => {
    const gs = game();
    gs.comeback!.players[0].losses = 2;
    award_hit(gs, gs.tanks[0], gs.tanks[0], 100, false);
    gs.mass_kill();
    expect(gs.tanks.map(t => roundEarnings(gs, t))).toEqual([7000, 7500]);
    expect(roundIncome(gs.comeback, 0, true)).toMatchObject({ penalties: -1500, recovery: 1000, victory: 0 });
  });

  it("uses the original assistance for unversioned Comeback saves", () => {
    const gs = game(); delete gs.comeback!.version; finish(gs);
    expect(gs.tanks.map(t => roundEarnings(gs, t))).toEqual([13500, 5500]);
  });

  it("excludes banked money and purchases from Classic round earnings", () => {
    const gs = game("CLASSIC");
    gs.tanks[0].cash -= 2000; // Simulate spending in a subsequent shop.
    gs.begin_next_round(); finish(gs);
    expect(roundEarnings(gs, gs.tanks[0])).toBe(8500);
    expect(gs.tanks[0].cash).toBe(16500);
    gs.proceed_after_round(); gs.begin_next_round();
    expect(roundEarnings(gs, gs.tanks[0])).toBe(0);
  });

  it("includes Classic Outlast cash", () => {
    const gs = game("CLASSIC"); gs.cfg.OUTLAST_BONUS = "ON"; gs.begin_next_round(); finish(gs);
    expect(roundEarnings(gs, gs.tanks[0])).toBe(9000);
  });

  it("restores a Classic starting balance and leaves older saves explicitly unknown", () => {
    const gs = game("CLASSIC");
    award_hit(gs, gs.tanks[0], gs.tanks[1], 40, false);
    expect(serialize(view(gs)).tanks[0].round_start_cash).toBe(10000);
    const restored = game("CLASSIC");
    apply(load(save(view(gs))), view(restored));
    expect(roundEarnings(restored, restored.tanks[0])).toBe(1200);
    const legacy = serialize(view(gs)); legacy.tanks.forEach(t => { delete t.round_start_cash; });
    apply(legacy, view(restored));
    expect(roundEarnings(restored, restored.tanks[0])).toBeUndefined();
  });
});
