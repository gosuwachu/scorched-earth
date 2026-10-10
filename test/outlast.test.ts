/** Browser-rule acceptance tests: these expectations are not DOS fixtures. */
import { describe, expect, it, vi } from "vitest";
import { Config } from "../src/config";
import { AIM, FIRING, SIM_LIVE, SYNC_VOLLEY, createGameState, type GameState } from "../src/game";
import { kill_tank, type State as DamageState, type Tank as DamageTank } from "../src/damage";
import { apply, load, save, serialize, type SaveGameState } from "../src/savegame";

function game(n = 3, overrides: Partial<Config> = {}): GameState {
  const cfg = Object.assign(new Config(), {
    OUTLAST_BONUS: "ON", MAXROUNDS: 3, MAX_WIND: 0, SKY: "PLAIN",
    SOUND: "OFF", TALKING_TANKS: "OFF", FALLING_TANKS: "OFF",
    ...overrides,
  });
  const gs = createGameState(cfg, 320, 200, 123);
  for (let i = 0; i < n; i++) gs.add_player(`Player ${i}`, 0, i % 2);
  gs.new_game();
  gs.phase = AIM;
  return gs;
}

function eliminate(gs: GameState, ...indices: number[]): void {
  for (const i of indices) gs.tanks[i].alive = false;
  gs.phase = AIM;
  gs.update(1 / 30);
}

function earned(gs: GameState): number[] {
  return gs.outlast!.players.map((p) => p.amount);
}

function saveView(gs: GameState): SaveGameState {
  return {
    ...gs,
    terrain: { grid: { w: gs.w, h: gs.h, data: gs.terrain.grid } },
  } as unknown as SaveGameState;
}

function restore(gs: GameState, bytes: Uint8Array): void {
  const view = apply(load(bytes), saveView(gs));
  gs.terrain.grid = view.terrain.grid.data;
  Object.assign(gs, view, { terrain: gs.terrain });
}

describe("optional outlast cash", () => {
  it("defaults off and persists either setting", () => {
    expect(new Config().OUTLAST_BONUS).toBe("OFF");
    expect(Config.load("SCORING=GREEDY").OUTLAST_BONUS).toBe("OFF");
    for (const value of ["ON", "OFF"]) {
      const cfg = Object.assign(new Config(), { OUTLAST_BONUS: value });
      expect(Config.load(cfg.save()).OUTLAST_BONUS).toBe(value);
    }
  });

  it.each(["BASIC", "STANDARD", "GREEDY"])("pays six-player placements as cash only in %s", (SCORING) => {
    const gs = game(6, { SCORING });
    for (let i = 0; i < 5; i++) eliminate(gs, i);
    expect(earned(gs)).toEqual([0, 500, 1000, 1500, 2000, 2500]);
    expect(gs.tanks.map((t) => t.cash)).toEqual([0, 0, 0, 0, 0, 0]);
    gs._end_round();
    const victory = SCORING === "BASIC" ? 6000 : 5000;
    expect(gs.tanks.map((t) => t.cash)).toEqual([0, 500, 1000, 1500, 2000, victory + 2500]);
    expect(gs.tanks.map((t) => t.score)).toEqual([0, 0, 0, 0, 0, victory]);
    expect(gs.tanks.map((t) => t.win_counter)).toEqual([0, 0, 0, 0, 0, 1]);
  });

  it("pays two-player winnings before interest and not again on subsequent updates", () => {
    const gs = game(2);
    eliminate(gs, 0);
    gs._end_round();
    expect(gs.tanks[1].cash).toBe(5500);
    gs.update(1 / 30);
    gs.proceed_after_round();
    expect(gs.tanks.map((t) => t.cash)).toEqual([0, 5775]);
    expect(gs.tanks[1].score).toBe(5000);
  });

  it("does not award interest after the final round", () => {
    const gs = game(2, { MAXROUNDS: 1 });
    eliminate(gs, 0);
    gs._end_round();
    gs.proceed_after_round();
    expect(gs.tanks[1].cash).toBe(5500);
  });

  it("ranks Greedy using the payout, without altering Standard scores", () => {
    const gs = game(3, { SCORING: "GREEDY" });
    eliminate(gs, 0);
    eliminate(gs, 1, 2);
    gs._end_round();
    expect(gs.ranking.map((t) => t.player_index)).toEqual([1, 2, 0]);
    expect(gs.tanks.map((t) => t.score)).toEqual([0, 0, 0]);
    expect(gs.tanks.map((t) => t.cash)).toEqual([0, 500, 500]);
  });

  it.each([false, true])("ties same-update eliminations regardless of roster order (reversed=%s)", (reverse) => {
    const gs = game(4);
    const tanks = gs.tanks.slice();
    if (reverse) gs.tanks.reverse();
    tanks[0].alive = tanks[1].alive = false;
    gs.update(1 / 30);
    expect(earned(gs)).toEqual([0, 0, 1000, 1000]);
    // A later chain-reaction death is a separate elimination.
    tanks[2].alive = false;
    gs.update(1 / 30);
    expect(earned(gs)).toEqual([0, 0, 1000, 1500]);
  });

  it.each(["STANDARD", "CORPORATE", "VICIOUS"])("ignores teammates in %s team mode", (TEAM_MODE) => {
    const gs = game(4, { TEAM_MODE });
    eliminate(gs, 0); // team 0: player 2 gets nothing
    expect(earned(gs)).toEqual([0, 500, 0, 500]);
    eliminate(gs, 1); // team 1: player 3 gets nothing
    expect(earned(gs)).toEqual([0, 500, 500, 500]);
  });

  it("gives no extra cash with the option disabled, or while waiting", () => {
    const off = game(2, { OUTLAST_BONUS: "OFF" });
    eliminate(off, 0);
    off._end_round();
    expect(off.outlast).toBeNull();
    expect(off.tanks[1].cash).toBe(5000);
    const gs = game();
    for (let i = 0; i < 100; i++) gs.update(1 / 30);
    expect(earned(gs)).toEqual([0, 0, 0]);
  });

  it("pays accrued bonuses on Mass Kill without rewarding its removals or paying twice", () => {
    const gs = game(4);
    eliminate(gs, 0);
    gs.mass_kill();
    expect(earned(gs)).toEqual([0, 500, 500, 500]);
    expect(gs.tanks.map((t) => t.cash)).toEqual([1250, 1750, 1750, 1750]);
    const before = gs.tanks.map((t) => t.cash);
    gs._end_round(); // no survivors; outlast itself must remain exactly-once
    expect(gs.tanks.map((t) => t.cash)).toEqual(before);
  });

  it("retains accrued bonuses after retreat and credits the remaining enemies", () => {
    const gs = game();
    eliminate(gs, 0);
    expect(gs.retreat(gs.tanks[1])).toBe(true);
    // SETTLE returns early while the retreat animation is pending.
    gs.update(1 / 30);
    expect(earned(gs)).toEqual([0, 500, 1000]);
    gs._end_round();
    expect(gs.tanks.map((t) => t.cash)).toEqual([0, 500, 6000]);
  });

  it.each(["SEQUENTIAL", "SYNCHRONOUS", "SIMULTANEOUS"])("batches actual death transitions in %s updates", (PLAY_MODE) => {
    const gs = game(4, { PLAY_MODE });
    gs.phase = PLAY_MODE === "SEQUENTIAL" ? FIRING : PLAY_MODE === "SYNCHRONOUS" ? SYNC_VOLLEY : SIM_LIVE;
    // Inject an environmental death and self-kill in one physics substep;
    // retain the real update dispatch and kill/death-queue hooks.
    vi.spyOn(gs, "_step_flight").mockImplementationOnce(() => {
      gs.current_shooter = null;
      kill_tank(gs as unknown as DamageState, gs.tanks[0] as unknown as DamageTank);
      gs.current_shooter = gs.tanks[1];
      kill_tank(gs as unknown as DamageState, gs.tanks[1] as unknown as DamageTank);
    }).mockImplementation(() => {});
    gs.update(1 / 30);
    expect(earned(gs)).toEqual([0, 0, 1000, 1000]);
  });

  it("applies option changes next round and resets accrual", () => {
    const gs = game();
    gs.cfg.OUTLAST_BONUS = "OFF";
    eliminate(gs, 0);
    expect(earned(gs)).toEqual([0, 500, 500]);
    gs.begin_next_round();
    expect(gs.outlast).toBeNull();
    gs.cfg.OUTLAST_BONUS = "ON";
    eliminate(gs, 0);
    expect(gs.outlast).toBeNull();
    gs.begin_next_round();
    expect(earned(gs)).toEqual([0, 0, 0]);
  });
});

describe("outlast save compatibility", () => {
  it("restores accrual and accounted eliminations without duplicating rewards", () => {
    const gs = game();
    eliminate(gs, 0);
    const view = saveView(gs);
    expect(load(save(view))).toEqual(serialize(view));
    const other = game();
    restore(other, save(view));
    other.update(1 / 30);
    expect(earned(other)).toEqual([0, 500, 500]);
    eliminate(other, 1);
    other._end_round();
    expect(other.tanks.map((t) => t.cash)).toEqual([0, 500, 6000]);
    expect(earned(gs)).toEqual([0, 500, 500]); // no shared tracker references
  });

  it("restores a paid round without paying again", () => {
    const gs = game();
    eliminate(gs, 0);
    eliminate(gs, 1, 2);
    gs._end_round();
    const other = game();
    restore(other, save(saveView(gs)));
    other._end_round();
    expect(other.tanks.map((t) => t.cash)).toEqual([0, 500, 500]);
  });

  it("retains this round's eligibility when the next-round setting differs", () => {
    const gs = game();
    gs.cfg.OUTLAST_BONUS = "OFF";
    const other = game();
    restore(other, save(saveView(gs)));
    eliminate(other, 0);
    expect(earned(other)).toEqual([0, 500, 500]);
    other.begin_next_round();
    expect(other.outlast).toBeNull();
  });

  it("loads an older save with the rule off and no retrospective rewards", () => {
    const gs = game();
    eliminate(gs, 0);
    const data = serialize(saveView(gs));
    delete data.outlast;
    delete data.cfg.OUTLAST_BONUS;
    const other = game();
    const view = apply(data, saveView(other));
    other.outlast = view.outlast ?? null;
    expect(other.cfg.OUTLAST_BONUS).toBe("OFF");
    other.cfg.OUTLAST_BONUS = "ON";
    eliminate(other, 1);
    other._end_round();
    expect(other.outlast).toBeNull();
    expect(other.tanks.map((t) => t.cash)).toEqual([0, 0, 5000]);
  });
});
