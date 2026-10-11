import { describe, expect, it, vi } from "vitest";
import type { Player } from "../shared/online";
import type { App } from "../src/main";
import { Config } from "../src/config";
import { createGameState } from "../src/game";
import { tank_color_index } from "../src/palette";
import { RemoteAdapter } from "../src/remote";
import { apply, load, save, serialize, type SaveGameState } from "../src/savegame";

// Online colour/identity regression coverage, not DOS fidelity fixtures.
function setup(mode = "SEQUENTIAL", colors?: number[]) {
  const cfg = new Config();
  Object.assign(cfg, { PLAY_MODE: mode, INITIAL_CASH: 100, MAX_WIND: 0,
    FALLING_TANKS: "OFF", SOUND: "OFF", TALKING_TANKS: "OFF", HOSTILE_ENVIRONMENT: "OFF" });
  const gs = createGameState(cfg, 640, 480, 17);
  const roster: Player[] = ["Alice", "Bob", "CPU"].map((name, i) => ({
    id: name, name, icon: 3, colorIndex: colors?.[i] ?? i, ai: i === 2 ? 1 : 0, ready: true, connected: true,
  }));
  for (const [i, p] of roster.entries()) gs.add_player(p.name, p.ai, 0, p.icon, colors?.[i]);
  gs.new_game();
  return { gs, roster };
}

function saveView(gs: ReturnType<typeof createGameState>): SaveGameState {
  // Same terrain bridge used by the application's Save/Restore screens.
  return { ...gs, terrain: { grid: { w: gs.w, h: gs.h, data: gs.terrain.grid } } } as unknown as SaveGameState;
}

describe("stable online tank colours", () => {
  it.each(["SEQUENTIAL", "SIMULTANEOUS"])("preserves gapped colours and input ownership through rounds in %s", (mode) => {
    const { gs, roster } = setup(mode, [1, 3, 0]);
    expect(gs.tanks.map((t) => t.color_index)).toEqual([1, 3, 0]); // Already available in the first shop.
    const app = { gs, top: {}, onlineScreen: "battle", onlineMenuOpen: false, transitioning: false,
      handleRemote: vi.fn(), _act: vi.fn() };
    const adapter = new RemoteAdapter(app as unknown as App, roster);
    for (let round = 0; round < 2; round++) {
      gs.start_round();
      expect(gs.tanks.map((t) => t.color)).toEqual([1, 3, 0].map(tank_color_index));
      expect(gs.tanks.map((t) => t.player_index)).toEqual([0, 1, 2]);
      gs.phase = mode === "SIMULTANEOUS" ? "sim_live" : "aim";
      gs.current_shooter = gs.tanks[1];
      const states = adapter.states(roster);
      expect(states.Alice.tank).toMatchObject({ name: "Alice", colorIndex: 1 });
      expect(states.Bob.tank).toMatchObject({ name: "Bob", colorIndex: 3 });
      expect(states.Bob.enabled).toBe(true);
      const before = gs.tanks.map((t) => t.angle);
      adapter.receive("Bob", states.Bob.context, round + 1, { kind: "key", key: "ArrowLeft", down: true }, round * 1000);
      if (mode === "SIMULTANEOUS") {
        expect(gs.tanks.map((t) => t.angle)).toEqual([before[0], before[1] + 1, before[2]]);
      } else {
        expect(app.handleRemote).toHaveBeenCalled();
        expect(states.Alice.enabled).toBe(false);
      }
      adapter.release();
    }
  });

  it("round-trips colour overrides and accepts older saves without them", () => {
    const { gs } = setup("SEQUENTIAL", [1, 3, 0]);
    gs.start_round();
    const saved = load(save(saveView(gs)));
    expect(saved.tanks.map((t) => t.color_index)).toEqual([1, 3, 0]);
    expect(serialize(saveView(gs)).tanks.map((t) => t.color_index)).toEqual([1, 3, 0]);
    const { gs: restored } = setup();
    apply(saved, saveView(restored));
    restored.start_round();
    expect(restored.tanks.map((t) => t.color)).toEqual([1, 3, 0].map(tank_color_index));

    const { gs: local } = setup();
    const oldSave = load(save(saveView(local)));
    expect(oldSave.tanks.every((t) => !("color_index" in t))).toBe(true);
    apply(oldSave, saveView(restored));
    restored.start_round();
    expect(restored.tanks.map((t) => t.color_index)).toEqual([undefined, undefined, undefined]);
    expect(restored.tanks.map((t) => t.color)).toEqual([0, 1, 2].map(tank_color_index));
  });
});
