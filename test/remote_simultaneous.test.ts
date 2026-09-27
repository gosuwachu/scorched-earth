import { describe, expect, it, vi } from "vitest";
import { Config } from "../src/config";
import { createGameState, SIM_LIVE, ROUND_END } from "../src/game";
import { RemoteAdapter } from "../src/remote";
import type { App } from "../src/main";
import type { Input, Player } from "../shared/online";
import { SLOT_BATTERY } from "../src/weapons";

// Network control regression cases, not DOS fidelity fixtures.
function setup() {
  const cfg = new Config();
  Object.assign(cfg, { PLAY_MODE: "SIMULTANEOUS", INITIAL_CASH: 0, MAX_WIND: 0,
    FALLING_TANKS: "OFF", SOUND: "OFF", TALKING_TANKS: "OFF" });
  const gs = createGameState(cfg, 640, 480, 17);
  const roster: Player[] = ["Alice", "Bob", "CPU"].map((name, i) => ({
    id: name, name, icon: 3, ai: i === 2 ? 1 : 0, ready: true, connected: true,
  }));
  for (const p of roster) gs.add_player(p.name, p.ai, 0, p.icon);
  gs.new_game(); gs.start_round();
  gs.tanks.forEach((t, i) => {
    t.angle = 90; t.power = 300; t.x = 100 + 200 * i; t.y = 350;
    t.inventory[1] = 3; t.selected_weapon = 0;
  });
  const app = { gs, top: {}, onlineScreen: "battle", transitioning: false, handleRemote: vi.fn(), _act: vi.fn() };
  const adapter = new RemoteAdapter(app as unknown as App, roster);
  const states = () => adapter.states(roster);
  const seq: Record<string, number> = {};
  const send = (player: string, input: Input, now = 0) => {
    adapter.receive(player, states()[player].context, seq[player] = (seq[player] ?? 0) + 1, input, now);
  };
  const key = (player: string, key: string, down = true, now = 0) => send(player, { kind: "key", key, down }, now);
  const plasma = (i: number) => {
    const t = gs.tanks[i]; t.inventory[31] = 3; t.inventory[SLOT_BATTERY] = 5; t.selected_weapon = 31;
    return t;
  };
  return { gs, roster, app, adapter, states, send, key, plasma };
}

describe("independent simultaneous controllers", () => {
  it("rejects fire during terrain settling without changing the controller context or spending ammunition", () => {
    const { gs, key, states, adapter } = setup();
    const t = gs.tanks[0];
    t.selected_weapon = 1;
    const context = states().Alice.context;
    gs.request_terrain_settle();
    key("Alice", "Space");
    expect(t.inventory[1]).toBe(3);
    expect(gs.projectiles).toHaveLength(0);
    expect(states().Alice.context).toBe(context);
    key("Alice", "ArrowLeft"); adapter.updateSimultaneous(0.1, 100);
    expect(t.angle).toBeGreaterThan(90);
    for (let i = 0; i < 500 && gs.sim_settling; i++) gs.update(1 / 60);
    expect(gs.sim_settling).toBe(false);
    expect(gs.projectiles).toHaveLength(0);
    key("Alice", "Space", false); key("Alice", "Space");
    expect(t.inventory[1]).toBe(2);
    expect(gs.projectiles).toHaveLength(1);
  });
  it("enables both humans without key bindings and scopes identical buttons to their tanks", () => {
    const { gs, states, key, adapter, app } = setup();
    expect(gs.phase).toBe(SIM_LIVE);
    expect(gs._sim_keymap).toEqual({});
    expect(Object.values(states()).map((s) => s.enabled)).toEqual([true, true]);
    const [a, b, cpu] = gs.tanks;
    gs.current_shooter = cpu;
    key("Alice", "ArrowLeft"); key("Bob", "ArrowLeft"); key("Bob", "ArrowUp");
    adapter.updateSimultaneous(0.1, 100);
    expect([a.angle, b.angle, cpu.angle]).toEqual([96, 96, 90]);
    expect([a.power, b.power, cpu.power]).toEqual([300, 326, 300]);
    key("Alice", "ArrowLeft", false, 110);
    adapter.updateSimultaneous(0.1, 200);
    expect([a.angle, b.angle]).toEqual([96, 101]);
    expect(gs.current_shooter).toBe(cpu);
    expect(app.handleRemote).not.toHaveBeenCalled();
    expect(states().Alice.controls).toEqual([]);
  });

  it("retains sub-unit movement at 60 Hz in both directions and clamps the limits", () => {
    const { gs } = setup(); const [a, b] = gs.tanks;
    for (let n = 0; n < 12; n++) { gs.sim_aim(a, 1, 1, 1 / 60); gs.sim_aim(b, -1, -1, 1 / 60); }
    expect([a.angle, b.angle, a.power, b.power]).toEqual([100, 80, 350, 250]);
    gs.sim_aim(a, 1, 1, 100); gs.sim_aim(b, -1, -1, 100);
    expect([a.angle, b.angle, a.power, b.power]).toEqual([180, 0, 1000, 0]);
  });

  it("cycles and fires independently, rejects duplicates, and gates only the owner's in-flight shot", () => {
    const { gs, key, states, adapter } = setup(); const [a, b] = gs.tanks;
    key("Alice", "Tab"); key("Alice", "Tab");
    expect([a.selected_weapon, b.selected_weapon]).toEqual([1, 0]);
    key("Alice", "BracketLeft"); expect(a.selected_weapon).toBe(0);
    const before = states();
    key("Alice", "Space"); key("Bob", "Space");
    expect(gs.projectiles.map((p) => p.owner)).toEqual([a, b]);
    key("Alice", "Space", false); key("Alice", "Space");
    expect(gs.projectiles).toHaveLength(2);
    expect(states().Alice.context).toBe(before.Alice.context);
    expect(states().Bob.context).toBe(before.Bob.context);
    key("Bob", "ArrowRight"); adapter.updateSimultaneous(0.1, 100);
    expect([a.angle, b.angle]).toEqual([90, 84]);
    gs.projectiles = gs.projectiles.filter((p) => p.owner !== a);
    key("Alice", "Space", false); key("Alice", "Space");
    expect(gs.projectiles.map((p) => p.owner)).toEqual([b, a]);
  });

  it("expires holds separately; heartbeats cannot create or resurrect a press", () => {
    const { gs, key, send, adapter } = setup(); const [a, b] = gs.tanks;
    key("Alice", "ArrowLeft"); key("Bob", "ArrowLeft", true, 100);
    send("Bob", { kind: "hold", keys: ["ArrowLeft", "ArrowUp"] }, 400);
    adapter.updateSimultaneous(0.1, 500);
    expect([a.angle, b.angle, b.power]).toEqual([91, 96, 300]);
    send("Alice", { kind: "hold", keys: ["ArrowLeft"] }, 501);
    adapter.updateSimultaneous(0.1, 900);
    expect([a.angle, b.angle]).toEqual([91, 96]);
    key("Alice", "ArrowLeft", true, 910);
    expect(a.angle).toBe(92);
  });

  it("rejects unknown, stale, out-of-order and cross-context commands", () => {
    const { gs, states, adapter, key } = setup();
    const before = states();
    for (const [player, context, seq] of [
      ["intruder", before.Alice.context, 1], ["CPU", before.Alice.context, 1],
      ["Alice", before.Bob.context, 1], ["Alice", before.Alice.context - 1, 1],
    ] as const) adapter.receive(player, context, seq, { kind: "key", key: "Space", down: true }, 0);
    expect(gs.projectiles).toHaveLength(0);
    key("Alice", "Tab");
    adapter.receive("Alice", before.Alice.context, 1, { kind: "key", key: "Space", down: true }, 0);
    expect(gs.projectiles).toHaveLength(0);
    key("Alice", "KeyI"); key("Alice", "Escape");
    expect(states().Alice.context).toBe(before.Alice.context);
  });

  it("disconnects and reconnects one controller without interrupting another", () => {
    const { gs, key, states, roster, adapter } = setup();
    key("Alice", "ArrowLeft"); key("Bob", "ArrowLeft");
    const before = states();
    roster[0].connected = false; adapter.release("Alice");
    expect(states().Alice.enabled).toBe(false);
    adapter.updateSimultaneous(0.1, 100);
    expect(gs.tanks.map((t) => t.angle)).toEqual([91, 96, 90]);
    expect(states().Bob.context).toBe(before.Bob.context);
    roster[0].connected = true;
    const resumed = states().Alice;
    expect(resumed.context).not.toBe(before.Alice.context);
    adapter.receive("Alice", before.Alice.context, 10, { kind: "key", key: "Space", down: true }, 150);
    expect(gs.projectiles).toHaveLength(0);
    adapter.receive("Alice", resumed.context, 1, { kind: "key", key: "Space", down: true }, 150);
    expect(gs.projectiles[0].owner).toBe(gs.tanks[0]);
  });

  it("invalidates dead players and round transitions without transferring their input", () => {
    const { gs, key, states, adapter, app } = setup();
    key("Alice", "ArrowLeft"); key("Bob", "ArrowLeft");
    const bob = states().Bob.context;
    gs.tanks[0].alive = false;
    expect(states().Alice.enabled).toBe(false);
    expect(states().Bob.context).toBe(bob);
    key("Alice", "Space"); expect(gs.projectiles).toHaveLength(0);
    gs.phase = ROUND_END; app.onlineScreen = "rankings";
    expect(Object.values(states()).every((s) => !s.enabled)).toBe(true);
    gs.round_index++; gs.phase = SIM_LIVE; app.onlineScreen = "battle"; gs.tanks[0].alive = true;
    const angle = gs.tanks[1].angle;
    adapter.updateSimultaneous(0.1, 100);
    expect(gs.tanks[1].angle).toBe(angle);
    expect(states().Bob.context).not.toBe(bob);
  });

  it("keeps two Plasma choices private while a third tank and the other controller can act", () => {
    const { gs, key, send, states, adapter, plasma } = setup(); const a = plasma(0), b = plasma(1);
    key("Bob", "ArrowLeft"); const bobContext = states().Bob.context;
    key("Alice", "Space");
    expect(gs.plasma_charge).toBeNull();
    expect(states().Alice.controls.map((c) => c.id)).toContain("plasma-charge");
    expect(states().Bob.controls).toEqual([]);
    expect(states().Bob.context).toBe(bobContext);
    adapter.updateSimultaneous(0.1, 100); expect(b.angle).toBe(96);
    key("Bob", "Space");
    send("Alice", { kind: "control", id: "plasma-charge", value: 2 });
    send("Bob", { kind: "control", id: "plasma-charge", value: 4 });
    expect(gs.sim_charges.get(a)?.value).toBe(2); expect(gs.sim_charges.get(b)?.value).toBe(4);
    key("Alice", "Tab"); key("Alice", "ArrowLeft");
    expect([a.selected_weapon, a.angle]).toEqual([31, 90]);
    gs.fire(gs.tanks[2]); expect(gs.projectiles[0].owner).toBe(gs.tanks[2]);
    const launch = vi.spyOn(gs, "fire");
    gs.current_shooter = gs.tanks[2];
    a.inventory[SLOT_BATTERY] = 1; // battery consumption while the battle continues
    send("Alice", { kind: "control", id: "plasma-fire" });
    expect(launch).toHaveBeenLastCalledWith(a);
    expect([a.inventory[31], a.batteries, b.inventory[31], b.batteries]).toEqual([2, 0, 3, 5]);
    expect(gs.current_shooter).toBe(gs.tanks[2]);
    expect(gs.sim_charges.get(b)?.value).toBe(4);
    send("Bob", { kind: "control", id: "plasma-cancel" });
    expect(gs.sim_charges.size).toBe(0); expect(b.batteries).toBe(5);
  });

  it("discards Plasma choices on disconnect, death and round end", () => {
    const { gs, key, adapter, states, plasma } = setup(); const a = plasma(0), b = plasma(1);
    key("Alice", "Space"); key("Bob", "Space");
    adapter.release("Alice");
    expect(gs.sim_charges.has(a)).toBe(false); expect(gs.sim_charges.has(b)).toBe(true);
    b.alive = false; states();
    expect(gs.sim_charges.size).toBe(0);
    key("Alice", "Space"); gs._end_round();
    expect(gs.sim_charges.size).toBe(0);
    gs.sim_confirm_plasma_charge(a); expect(a.inventory[31]).toBe(3);
  });

  for (const invalidation of ["death", "ammo", "weapon", "flight", "phase"]) {
    it(`revalidates Plasma confirmation after ${invalidation} changes`, () => {
      const { gs, plasma } = setup(); const a = plasma(0);
      gs.sim_fire(a); gs.sim_set_plasma_charge(a, 3);
      if (invalidation === "death") a.alive = false;
      if (invalidation === "ammo") a.inventory[31] = 0;
      if (invalidation === "weapon") a.selected_weapon = 0;
      if (invalidation === "phase") gs.phase = ROUND_END;
      if (invalidation === "flight") {
        a.selected_weapon = 0; gs.fire(a); a.selected_weapon = 31;
      }
      const ammo = a.inventory[31], count = gs.projectiles.length;
      gs.sim_confirm_plasma_charge(a);
      expect([a.batteries, a.inventory[31], gs.projectiles.length]).toEqual([5, ammo, count]);
      expect(gs.sim_charges.has(a)).toBe(false);
    });
  }
});
