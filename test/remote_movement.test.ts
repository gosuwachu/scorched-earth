import { describe, expect, it, vi } from "vitest";
import { Config } from "../src/config";
import { createGameState } from "../src/game";
import { handle_game_event } from "../src/ingame";
import { RemoteAdapter } from "../src/remote";
import type { App } from "../src/main";
import type { Input, Player } from "../shared/online";
import { SLOT_FUEL, SLOT_SHIELD, SLOT_SUPER_MAG } from "../src/weapons";

// Guest input and ownership regression checks, not DOS movement fixtures.
function setup() {
  const cfg = new Config();
  Object.assign(cfg, { PLAY_MODE: "SEQUENTIAL", INITIAL_CASH: 0, MAX_WIND: 0,
    FALLING_TANKS: "OFF", SOUND: "OFF", TALKING_TANKS: "OFF" });
  const gs = createGameState(cfg, 640, 480, 17);
  const roster: Player[] = ["Alice", "Bob"].map((name) => ({ id: name, name, icon: 3, ai: 0, ready: true, connected: true }));
  for (const p of roster) gs.add_player(p.name, p.ai, 0, p.icon);
  gs.new_game(); gs.start_round();
  gs.phase = "aim"; gs.current_shooter = gs.tanks[0];
  const tank = gs.tanks[0];
  tank.x = 200; tank.y = gs.terrain.column_top(200) - 1; tank.angle = 90;
  tank.mobile = true; tank.inventory[SLOT_FUEL] = 0; tank.fuel_remainder = 20;
  const app = { gs, top: {}, onlineScreen: "battle", onlineMenuOpen: false, transitioning: false,
    handleRemote: (event: Parameters<typeof handle_game_event>[1]) => handle_game_event(gs as never, event), _act: vi.fn() };
  const adapter = new RemoteAdapter(app as unknown as App, roster);
  const states = () => adapter.states(roster);
  let seq = 0;
  const send = (input: Input, now = 0) => adapter.receive("Alice", states().Alice.context, ++seq, input, now);
  const key = (key: string, down = true, now = 0) => send({ kind: "key", key, down }, now);
  return { gs, tank, roster, app, adapter, states, send, key };
}

describe("guest movement mode", () => {
  it.each(["aim", "sim_live"])("reports each player's own active shield strength during %s", (phase) => {
    const { gs, tank, states } = setup();
    gs.phase = phase;
    tank.shield_item = SLOT_SHIELD; tank.shield_hp = 37;
    gs.tanks[1].shield_item = SLOT_SUPER_MAG; gs.tanks[1].shield_hp = 100;
    expect(states().Alice.tank?.shield).toEqual({ name: "Shield", percent: 37 });
    expect(states().Bob.tank?.shield).toEqual({ name: "Super Mag", percent: 50 });
    tank.shield_hp = 0;
    expect(states().Alice.tank?.shield).toBeUndefined();
  });

  it("moves once per press without leaking held movement into angle adjustment", () => {
    const { tank, adapter, send, key, states } = setup();
    send({ kind: "control", id: "move" });
    expect(states().Alice.movement?.active).toBe(true);
    const x = tank.x;
    key("ArrowLeft");
    const fuel = tank.fuel;
    send({ kind: "hold", keys: ["ArrowLeft"] }, 400);
    adapter.updateAim(600);
    expect(tank.x).toBe(x - 1);
    expect(tank.fuel).toBe(fuel);
    expect(tank.angle).toBe(90);
    key("ArrowLeft", false, 610);
    key("ArrowRight", true, 620);
    expect(tank.x).toBe(x);
    const power = tank.power;
    key("ArrowUp", true, 630);
    expect(tank.power).toBe(power + 1);
  });

  it.each(["KeyF", "Escape", "Enter"])("exits with %s and rejects commands from the previous mode", (exit) => {
    const { tank, adapter, send, states, key } = setup();
    const before = states().Alice.context;
    send({ kind: "control", id: "move" });
    const during = states().Alice.context;
    expect(during).not.toBe(before);
    adapter.receive("Alice", before, 100, { kind: "key", key: "ArrowLeft", down: true }, 0);
    expect(tank.x).toBe(200);
    key("ArrowLeft");
    key(exit);
    expect(states().Alice.movement?.active).toBe(false);
    expect(states().Alice.context).not.toBe(during);
    expect(Object.keys(adapter.keys(0))).toHaveLength(0);
    adapter.updateAim(400);
    expect(tank.angle).toBe(90);
    key("ArrowLeft");
    expect(tank.angle).toBe(91);
  });

  it("reports exhaustion and immobility and keeps the mode exit available", () => {
    const { tank, states, send, key } = setup();
    tank.fuel_remainder = 1;
    send({ kind: "control", id: "move" }); key("ArrowLeft");
    expect(states().Alice.movement).toMatchObject({ active: true, available: false, fuel: 0, reason: "No fuel" });
    expect(states().Alice.controls.find((c) => c.id === "move")?.disabled).toBe(false);
    const x = tank.x;
    key("ArrowRight"); expect(tank.x).toBe(x);
    send({ kind: "control", id: "move" });
    send({ kind: "control", id: "move" });
    expect(states().Alice.movement?.active).toBe(false);
    tank.fuel_remainder = 10; tank.mobile = false;
    expect(states().Alice.movement).toMatchObject({ available: false, reason: "Immobile tank" });
    key("KeyF"); expect(states().Alice.movement?.active).toBe(false);
  });

  it("does not spend fuel at a field edge", () => {
    const { tank, send, key } = setup();
    tank.x = tank.half_width;
    send({ kind: "control", id: "move" }); key("ArrowLeft");
    expect(tank.x).toBe(tank.half_width);
    expect(tank.fuel).toBe(20);
  });

  it("keeps waiting players' own values and clears movement at turn changes", () => {
    const { gs, tank, adapter, states, send } = setup();
    send({ kind: "control", id: "move" });
    const old = states().Alice;
    const bob = states().Bob;
    expect(bob.movement).toMatchObject({ active: false, available: false, fuel: gs.tanks[1].fuel });
    adapter.receive("Bob", bob.context, 100, { kind: "key", key: "ArrowLeft", down: true });
    expect(tank.x).toBe(200);
    gs.current_shooter = gs.tanks[1];
    const next = states();
    expect(gs.move_mode).toBe(false);
    expect(next.Bob.movement?.active).toBe(false);
    adapter.receive("Alice", old.context, 101, { kind: "key", key: "ArrowLeft", down: true });
    expect(tank.x).toBe(200);
  });

  it("disables movement in simultaneous play", () => {
    const { gs, tank, states, send, key } = setup();
    gs.phase = "sim_live";
    expect(states().Alice.movement).toMatchObject({ active: false, available: false, reason: "Unavailable in simultaneous play" });
    send({ kind: "control", id: "move" }); key("KeyF");
    expect(tank.x).toBe(200);
    expect(gs.move_mode).toBeFalsy();
  });
});
