import { describe, it, expect } from "vitest";
import { Config } from "../src/config";
import { createGameState, AIM, FIRING } from "../src/game";
import { Projectile } from "../src/objects";
import { ITEMS } from "../src/weapons";
import * as targeting from "../src/targeting";
import * as guidance from "../src/guidance";
import * as ingame from "../src/ingame";
import * as pg from "../src/pygame";
import { RemoteAdapter } from "../src/remote";
import type { App } from "../src/main";
import type { Input } from "../shared/online";

function game(slot = 37, mode = "SEQUENTIAL") {
  const cfg = new Config();
  Object.assign(cfg, { PLAY_MODE: mode, SOUND: "OFF", FLY_SOUND: "OFF", TALKING_TANKS: "OFF", INITIAL_CASH: 0,
    MAX_WIND: 0, FALLING_TANKS: "OFF" });
  const gs = createGameState(cfg, 320, 240, 17);
  gs.add_player("A", 0, 0, 0); gs.add_player("B", 0, 0, 1); gs.new_game();
  gs.terrain.grid.fill(0);
  gs.tanks.forEach((t, i) => { t.x = i ? 260 : 30; t.y = 200; t.health = 100; t.alive = true; t.inventory.fill(0); });
  gs.phase = AIM; gs.current_shooter = gs.tanks[0];
  const t = gs.tanks[0]; t.inventory[slot] = 2; t.selected_guidance = slot; t.angle = 45; t.power = 250;
  return gs;
}
describe("guided firing requests", () => {
  for (const slot of [34, 35, 36, 37]) it(`Fire waits for target, slot ${slot}`, () => {
    const gs = game(slot), t = gs.tanks[0], ammo = t.inventory[0];
    expect(gs.fire()).toEqual([]); expect(gs.pendingTarget?.guidance).toBe(slot);
    expect([gs.phase, t.inventory[slot], t.inventory[0]]).toEqual([AIM, 2, ammo]);
    expect(gs.fire()).toEqual([]); // repeated Fire neither launches nor resets draft
    expect(targeting.setPoint(gs, 230, 100)).toBe(true);
    expect(targeting.confirm(gs)).toBe(true);
    expect([gs.phase, t.inventory[slot], t.selected_guidance, gs.projectiles.length]).toEqual([FIRING, 1, null, 1]);
    expect(targeting.confirm(gs)).toBe(false);
  });
  it("Heat fires without a picker, attaches, consumes once, and resets", () => {
    const gs = game(33), t = gs.tanks[0];
    expect(gs.fire()).toHaveLength(1); expect(gs.pendingTarget).toBeNull();
    expect(gs.projectiles[0].guidance).toMatchObject({ type: "heat" });
    expect([t.inventory[33], t.selected_guidance]).toEqual([1, null]);
  });
  it("a fresh shot never silently reuses the previous target", () => {
    const gs = game(); gs.tanks[0].guidance_target_pt = [50, 50];
    gs.fire(); expect(gs.pendingTarget?.point).toBeNull();
    expect(targeting.confirm(gs)).toBe(false);
  });
  it("cancel preserves stock and aim, then another Fire opens a fresh request", () => {
    const gs = game(), t = gs.tanks[0]; gs.fire();
    targeting.setPoint(gs, 40, 50); targeting.cancel(gs);
    expect([t.inventory[37], t.angle, t.power, t.selected_guidance]).toEqual([2, 45, 250, 37]);
    expect(gs.phase).toBe(AIM); gs.fire(); expect(gs.pendingTarget?.point).toBeNull();
  });
  for (const weapon of [6, 7, 15, 16, 31]) it(`incompatible weapon ${weapon} preserves guidance stock`, () => {
    const gs = game(), t = gs.tanks[0]; t.selected_weapon = weapon; t.inventory[weapon] = 1;
    gs.fire(); expect(gs.pendingTarget).toBeNull(); expect(t.inventory[37]).toBe(2); expect(t.selected_guidance).toBeNull();
  });
  it("depleted guidance cannot be used even via an injected selection", () => {
    const gs = game(), t = gs.tanks[0]; t.inventory[37] = 0;
    gs.fire(); expect(gs.pendingTarget).toBeNull(); expect(gs.projectiles[0].guidance).toBeNull();
  });
  it("simultaneous mode does not arm or spend guidance", () => {
    const gs = game(37, "SIMULTANEOUS"); gs.fire(gs.tanks[0]);
    expect(gs.projectiles[0].guidance).toBeNull(); expect(gs.tanks[0].inventory[37]).toBe(2);
  });
  it("synchronous selection locks first, then the volley spends guidance", () => {
    const gs = game(37, "SYNCHRONOUS"), t = gs.tanks[0];
    gs.fire(); targeting.setPoint(gs, 200, 80); targeting.confirm(gs);
    expect(gs.projectiles).toHaveLength(0); expect(t.inventory[37]).toBe(2);
    gs._sync_launch_volley();
    expect(gs.projectiles).toHaveLength(1); expect(t.inventory[37]).toBe(1);
    expect(gs.projectiles[0].guidance).toMatchObject({ point: [200, 80] });
  });
  it("rejects invalid coordinates and a target that died before confirmation", () => {
    const gs = game(); gs.fire();
    for (const point of [[NaN, 10], [-1, 20], [320, 10], [20, 239], [10.5, 10]])
      expect(targeting.setPoint(gs, point[0], point[1])).toBe(false);
    targeting.selectTank(gs, gs.tanks[1]); gs.tanks[1].alive = false;
    expect(targeting.confirm(gs)).toBe(false); expect(gs.projectiles).toHaveLength(0);
  });
  it("targeting owns Escape and aim keys; numbers follow living tanks left to right", () => {
    const gs = game(); gs.tanks.reverse(); gs.fire();
    ingame.handle_game_event(gs as never, { type: pg.KEYDOWN, key: pg.K_LEFT });
    expect(gs.pendingTarget?.shooter.angle).toBe(45);
    ingame.handle_game_event(gs as never, { type: pg.KEYDOWN, key: pg.K_ESCAPE });
    expect(gs.pendingTarget).toBeNull(); expect(gs.phase).toBe(AIM);
    gs.fire(); ingame.handle_game_event(gs as never, { type: pg.KEYDOWN, key: pg.K_2 });
    expect(gs.projectiles[0].guidance).toMatchObject({ point: [260, 200] });
  });
  it("a multi-turret salvo spends only one accessory", () => {
    const gs = game(33), t = gs.tanks[0]; t.tank_icon = 6;
    const shots = gs.fire();
    expect(shots).toHaveLength(3); expect(t.inventory[33]).toBe(1);
    expect(shots.every((p) => !!p.guidance)).toBe(true);
  });
});

describe("guided flight integration", () => {
  it("Lazy Boy detonates in empty air at the exact chosen point", () => {
    const gs = game(); gs.fire(); targeting.setPoint(gs, 200, 80); targeting.confirm(gs);
    for (let i = 0; i < 2000 && !gs.projectiles[0]?.weaponEffect; i++) gs._step_flight();
    expect(gs.last_landing).toEqual([200, 80]);
    expect(gs.projectiles[0]?.weaponEffect).toMatchObject({ kind: "blast", x: 200, y: 80 });
  });
  it("swept Vertical acquisition cannot skip the target column", () => {
    const gs = game(36), t = gs.tanks[0]; t.guidance_target_pt = [130, 200];
    const p = new Projectile(t, ITEMS[0], 129, 80, 1000, 0);
    guidance.attach(t, gs.cfg, ITEMS[0], p); gs.projectiles.push(p);
    for (let i = 0; i < 5 && !(p.guidance as guidance.Guidance).armed; i++) gs._step_flight();
    expect((p.guidance as guidance.Guidance).armed).toBe(true); expect(p.px).toBe(130);
  });
  it("Vertical steering still encounters Force Shield before the tank", () => {
    const gs = game(36), [owner, target] = gs.tanks;
    target.inventory[42] = 1; gs._arm_best_shield(target, false);
    owner.guidance_target_pt = [target.x, target.y];
    const p = new Projectile(owner, ITEMS[0], target.x, target.y - 40, 0, -100);
    guidance.attach(owner, gs.cfg, ITEMS[0], p); gs.projectiles.push(p);
    for (let i = 0; i < 2000 && target.shield_hp === 100; i++) gs._step_flight();
    // Steering reaches the 1000 speed cap: Force reflection costs ten HP.
    expect(target.shield_hp).toBe(90); expect(target.health).toBe(100);
    expect(p.vy).toBeGreaterThan(0); expect(p.active).toBe(true);
  });
  it("Lazy Boy's separate callback bypasses Force Shield and reaches the chosen tank", () => {
    const gs = game(), [owner, target] = gs.tanks;
    target.inventory[42] = 1; gs._arm_best_shield(target, false);
    owner.guidance_target = target; owner.guidance_target_pt = [target.x, target.y];
    const p = new Projectile(owner, ITEMS[0], target.x, target.y - 40, 0, -100);
    guidance.attach(owner, gs.cfg, ITEMS[0], p); gs.projectiles.push(p);
    for (let i = 0; i < 1000 && target.alive; i++) gs._step_flight();
    expect(target.alive).toBe(false); expect(gs.direct_hit_tank).toBe(target);
  });
});

describe("online targeting authority", () => {
  it("shares the pending draft, rejects other players/stale/replayed inputs and restores reconnect state", () => {
    const gs = game(); gs.fire();
    const app = { gs, top: {}, onlineScreen: "battle", transitioning: false } as unknown as App;
    const roster = gs.tanks.map((t, i) => ({ id: String(i), name: t.name, icon: 0, ai: 0, ready: true, connected: true }));
    const remote = new RemoteAdapter(app, roster);
    const view = remote.states(roster)["0"];
    expect(view.targeting).toBe(true); expect(view.controls.some((c) => c.id === "target-0")).toBe(true);
    const input = { kind: "control", id: "target-tank-1" } as const;
    remote.receive("1", view.context, 1, input); expect(gs.pendingTarget?.point).toBeNull();
    remote.receive("0", view.context-1, 1, input); expect(gs.pendingTarget?.point).toBeNull();
    remote.receive("0", view.context, 1, input); expect(gs.pendingTarget?.point).toEqual([260, 200]);
    roster[0].connected = false; remote.states(roster); roster[0].connected = true;
    const resumed = remote.states(roster)["0"];
    expect(resumed.context).toBeGreaterThan(view.context);
    expect(resumed.controls.find((c) => c.id === "target-0")?.value).toBe(260);
    remote.receive("0", resumed.context, 2, { kind: "control", id: "target-fire" });
    remote.receive("0", resumed.context, 2, { kind: "control", id: "target-fire" });
    expect(gs.projectiles).toHaveLength(1); expect(gs.tanks[0].inventory[37]).toBe(1);
  });
});

// Guest ergonomics/ownership regression checks, not DOS input fixtures.
describe("online target arrows", () => {
  function setup(mode = "SEQUENTIAL") {
    const gs = game(37, mode); gs.fire();
    const app = { gs, top: {}, onlineScreen: "battle", transitioning: false, onlineMenuOpen: false,
      handleRemote: (event: ingame.IngameEvent) => ingame.handle_game_event(gs as never, event),
      _act: () => {} };
    const roster = gs.tanks.map((t, i) => ({ id: String(i), name: t.name, icon: 0, ai: 0, ready: true, connected: true }));
    const remote = new RemoteAdapter(app as unknown as App, roster);
    const view = () => remote.states(roster)["0"];
    let seq = 0;
    const send = (input: Input, now = 0) => remote.receive("0", view().context, ++seq, input, now);
    const key = (key: string, down = true, now = 0) => send({ kind: "key", key, down }, now);
    return { gs, app, roster, remote, view, send, key };
  }

  it("publishes read-only center coordinates without selecting or accepting coordinate edits", () => {
    const { gs, view, send, remote } = setup();
    expect(view().controls.find((c) => c.id === "target-0")).toMatchObject({ kind: "readout", value: 160, min: 0, max: 319 });
    expect(view().controls.find((c) => c.id === "target-1")).toMatchObject({ kind: "readout", value: 120, min: 0, max: 238 });
    expect(view().controls.find((c) => c.id === "target-fire")?.disabled).toBe(true);
    send({ kind: "control", id: "target-0", value: 10 });
    send({ kind: "hold", keys: ["ArrowRight"] });
    remote.updateAim(400);
    expect(gs.pendingTarget?.point).toBeNull();
  });

  it.each(["SEQUENTIAL", "SYNCHRONOUS"])("nudges one pixel per tap in %s without changing tank aim or fuel", (mode) => {
    const { gs, view, key, remote } = setup(mode);
    const t = gs.tanks[0], fuel = t.fuel;
    let now = 0;
    for (const [code, expected] of [
      ["ArrowRight", [161, 120]], ["ArrowUp", [161, 119]],
      ["ArrowLeft", [160, 119]], ["ArrowDown", [160, 120]],
    ] as const) {
      key(code, true, now); key(code, true, now); // Browser key-repeat cannot add a second tap.
      key(code, false, now + 10); remote.updateAim(now + 400);
      expect(gs.pendingTarget?.point).toEqual(expected);
      now += 500;
    }
    expect(view().controls.find((c) => c.id === "target-fire")?.disabled).toBe(false);
    expect([t.angle, t.power, t.fuel]).toEqual([45, 250, fuel]);
  });

  it("moves held arrows on host frames and stops immediately on release", () => {
    const { gs, key, send, remote } = setup();
    key("ArrowRight"); key("ArrowUp");
    remote.updateAim(350); expect(gs.pendingTarget?.point).toEqual([161, 119]);
    send({ kind: "hold", keys: ["ArrowRight", "ArrowUp"] }, 400);
    remote.updateAim(600); expect(gs.pendingTarget?.point).toEqual([174, 106]);
    key("ArrowRight", false, 610); key("ArrowUp", false, 610);
    remote.updateAim(1000); expect(gs.pendingTarget?.point).toEqual([174, 106]);
    expect([gs.tanks[0].angle, gs.tanks[0].power]).toEqual([45, 250]);
  });

  it("clamps every edge and only detaches a tank when a nudge changes its point", () => {
    const { gs, key, send, remote } = setup();
    gs.tanks[1].x = 0; gs.tanks[1].y = 0;
    send({ kind: "control", id: "target-tank-1" });
    key("ArrowLeft"); key("ArrowUp");
    expect(gs.pendingTarget?.point).toEqual([0, 0]);
    expect(gs.pendingTarget?.target).toBe(gs.tanks[1]);
    key("ArrowLeft", false); key("ArrowUp", false); key("ArrowRight");
    expect(gs.pendingTarget?.point).toEqual([1, 0]);
    expect(gs.pendingTarget?.target).toBeNull();
    key("ArrowDown");
    for (let now = 100; now <= 3000; now += 100) {
      send({ kind: "hold", keys: ["ArrowRight", "ArrowDown"] }, now); remote.updateAim(now);
    }
    expect(gs.pendingTarget?.point).toEqual([319, 238]);
    key("ArrowRight", false, 3010); key("ArrowDown", false, 3010);
    key("ArrowLeft", true, 3020); key("ArrowUp", true, 3020);
    expect(gs.pendingTarget?.point).toEqual([318, 237]);
  });

  it.each(["button", "digit"])("selecting a tank via %s stops a held nudge", (method) => {
    const { gs, key, send, remote } = setup();
    key("ArrowLeft"); send({ kind: "hold", keys: ["ArrowLeft"] }, 400);
    remote.updateAim(600);
    if (method === "button") send({ kind: "control", id: "target-tank-1" }, 610);
    else key("Digit2", true, 610);
    send({ kind: "hold", keys: ["ArrowLeft"] }, 700); remote.updateAim(800);
    expect(gs.pendingTarget?.point).toEqual([260, 200]);
    expect(gs.pendingTarget?.target).toBe(gs.tanks[1]);
  });

  it("rejects other players, stale contexts and replayed arrow presses", () => {
    const { gs, view, remote } = setup();
    const context = view().context;
    const input: Input = { kind: "key", key: "ArrowRight", down: true };
    remote.receive("1", context, 1, input, 0);
    remote.receive("0", context - 1, 1, input, 0);
    expect(gs.pendingTarget?.point).toBeNull();
    remote.receive("0", context, 1, input, 0);
    remote.receive("0", context, 2, { ...input, down: false }, 10);
    remote.receive("0", context, 1, input, 20);
    expect(gs.pendingTarget?.point).toEqual([161, 120]);
  });

  it.each(["expiry", "disconnect", "pause"])("preserves the draft but drops held movement after %s", (reason) => {
    const { gs, key, send, remote, app, roster, view } = setup();
    key("ArrowRight"); send({ kind: "hold", keys: ["ArrowRight"] }, 400);
    remote.updateAim(600);
    const point = [...gs.pendingTarget!.point!];
    if (reason === "disconnect") { roster[0].connected = false; view(); roster[0].connected = true; view(); }
    if (reason === "pause") { app.onlineMenuOpen = true; view(); app.onlineMenuOpen = false; view(); }
    remote.updateAim(900);
    send({ kind: "hold", keys: ["ArrowRight"] }, 1000); remote.updateAim(1200);
    expect(gs.pendingTarget?.point).toEqual(point);
    key("ArrowRight", true, 1300);
    expect(gs.pendingTarget?.point).toEqual([point[0] + 1, point[1]]);
  });

  it.each(["target-cancel", "Escape", "target-fire", "turn"])("drops held target input on %s without leaking into aim", (exit) => {
    const { gs, key, send, remote, view } = setup();
    key("ArrowRight"); send({ kind: "hold", keys: ["ArrowRight"] }, 400); remote.updateAim(600);
    const context = view().context;
    if (exit === "Escape") key("Escape", true, 610);
    else if (exit === "turn") { gs.current_shooter = gs.tanks[1]; view(); }
    else send({ kind: "control", id: exit }, 610);
    remote.receive("0", context, 100, { kind: "key", key: "ArrowUp", down: true }, 700);
    remote.updateAim(800);
    expect(Object.keys(remote.keys(800))).toHaveLength(0);
    expect([gs.tanks[0].angle, gs.tanks[0].power]).toEqual([45, 250]);
    if (exit !== "turn") {
      expect(gs.pendingTarget).toBeNull();
      expect(gs.tanks[0].inventory[37]).toBe(exit === "target-fire" ? 1 : 2);
    }
  });
});
