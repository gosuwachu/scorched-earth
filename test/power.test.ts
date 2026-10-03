import { describe, expect, it, vi } from "vitest";
import { maxPower, clampPower } from "../src/power";
import { Config } from "../src/config";
import { createGameState, AIM, SIM_LIVE } from "../src/game";
import * as damage from "../src/damage";
import * as targeting from "../src/targeting";
import * as ai from "../src/ai";
import * as pg from "../src/pygame";
import { HumanController } from "../src/ui";
import { SLOT_BATTERY } from "../src/weapons";

// Health × 10 is documented at DOS UI caller 38b5:107d in
// oracle/GUIDANCE_FIDELITY.md. These are browser integration regressions.
function game(mode = "SEQUENTIAL") {
  const cfg = new Config();
  Object.assign(cfg, { PLAY_MODE: mode, INITIAL_CASH: 0, MAX_WIND: 0,
    FALLING_TANKS: "OFF", SOUND: "OFF", TALKING_TANKS: "OFF" });
  const gs = createGameState(cfg, 320, 240, 17);
  gs.add_player("A", 0); gs.add_player("B", 0); gs.new_game();
  gs.terrain.grid.fill(0);
  gs.tanks.forEach((t, i) => { t.x = 50 + 200 * i; t.y = 200; });
  gs.current_shooter = gs.tanks[0]; gs.phase = AIM;
  return gs;
}

describe("health-limited power", () => {
  it.each([[100, 1000], [30, 300], [1, 10], [0, 0], [-1, 0], [110, 1000]])(
    "%i health permits at most %i power", (health, cap) => {
      expect(maxPower(health)).toBe(cap);
      expect(clampPower(health, 1000)).toBe(cap);
      expect(clampPower(health, -1)).toBe(0);
    });

  it("hull damage immediately lowers excess power, and healing only raises the limit", () => {
    const gs = game(), t = gs.tanks[0]; t.power = 1000;
    damage.apply_tank_damage(gs as never, t, 70);
    expect([t.health, t.power]).toEqual([30, 300]);
    t.inventory[SLOT_BATTERY] = 1;
    HumanController._use_battery(t);
    expect([t.health, t.power, t.batteries]).toEqual([40, 300, 0]);
    HumanController.update_continuous(gs as never, { [pg.K_UP]: true }, 2);
    expect(t.power).toBe(400);
  });

  it("preserves a lower selection and does not reduce power for shield-only damage", () => {
    const gs = game(), t = gs.tanks[0];
    t.power = 1000; t.shield_item = 42; t.shield_hp = 100;
    damage.apply_tank_damage(gs as never, t, 70);
    expect([t.health, t.power, t.shield_hp]).toEqual([100, 1000, 30]);
    t.power = 200;
    damage.apply_fall_damage(gs as never, t, 70);
    expect([t.health, t.power]).toEqual([30, 200]);
    damage.apply_fall_damage(gs as never, t, 30);
    expect([t.health, t.power, t.alive]).toEqual([0, 0, false]);
  });

  it("caps keyboard taps and holds at current health", () => {
    const gs = game(), t = gs.tanks[0]; t.health = 30; t.power = 299;
    for (let i = 0; i < 3; i++) HumanController.handle(gs as never, { type: pg.KEYDOWN, key: pg.K_UP });
    expect(t.power).toBe(300);
    HumanController.update_continuous(gs as never, { [pg.K_UP]: true }, 2);
    expect(t.power).toBe(300);
    HumanController.handle(gs as never, { type: pg.KEYDOWN, key: pg.K_DOWN });
    expect(t.power).toBe(299);
  });

  it.each(["SEQUENTIAL", "SYNCHRONOUS", "SIMULTANEOUS"])(
    "%s launches humans and AI at the bounded speed", (mode) => {
      for (const aiClass of [0, 1]) {
        const gs = game(mode), t = gs.tanks[0];
        t.ai_class = aiClass; t.health = 30; t.power = 1000;
        if (mode === "SIMULTANEOUS") gs._sim_begin_round();
        if (mode === "SYNCHRONOUS") {
          gs._sync_record_lock(t, 45, 1000, 0);
          expect(gs._sync_locks[t.player_index][1]).toBe(300);
          gs._sync_launch_volley();
        } else if (mode === "SIMULTANEOUS" && aiClass === 0) gs.sim_fire(t);
        else gs.fire(aiClass === 0 ? null : t);
        expect(t.power).toBe(300);
        expect(gs.projectiles).toHaveLength(1);
        // Trigonometry only: speed has a small floating-point roundoff.
        expect(Math.hypot(gs.projectiles[0].vx, gs.projectiles[0].vy)).toBeCloseTo(300, 10);
      }
    });

  it("rechecks health after synchronous locking", () => {
    const gs = game("SYNCHRONOUS"), t = gs.tanks[0];
    gs._sync_record_lock(t, 45, 1000, 0);
    damage.apply_fall_damage(gs as never, t, 70);
    gs._sync_launch_volley();
    expect(t.power).toBe(300);
    expect(Math.hypot(gs.projectiles[0].vx, gs.projectiles[0].vy)).toBeCloseTo(300, 10);
  });

  it("caps restored targeting power using current health", () => {
    const gs = game(), t = gs.tanks[0];
    t.selected_guidance = 35; t.inventory[35] = 1; t.power = 1000;
    gs.fire();
    expect(gs.pendingTarget?.power).toBe(1000);
    damage.apply_fall_damage(gs as never, t, 70);
    targeting.setPoint(gs, 230, 100); expect(targeting.confirm(gs)).toBe(true);
    expect(t.power).toBe(300);
    expect(Math.hypot(gs.projectiles[0].vx, gs.projectiles[0].vy)).toBeCloseTo(300, 10);
  });

  it("damage changes future simultaneous shots without slowing airborne shells", () => {
    const gs = game("SIMULTANEOUS"), t = gs.tanks[0]; gs._sim_begin_round();
    t.power = 1000; gs.sim_fire(t);
    const p = gs.projectiles[0], velocity = [p.vx, p.vy];
    damage.apply_fall_damage(gs as never, t, 70);
    expect(t.power).toBe(300); expect([p.vx, p.vy]).toEqual(velocity);
    gs.sim_adjust(t, 0, 1000); expect(t.power).toBe(300);
    gs.projectiles = []; gs.phase = SIM_LIVE; gs.sim_fire(t);
    expect(Math.hypot(gs.projectiles[0].vx, gs.projectiles[0].vy)).toBeCloseTo(300, 10);
  });

  it("bounds an excessive AI decision before exposing or firing it", () => {
    const gs = game("SYNCHRONOUS"), t = gs.tanks[0];
    t.ai_class = 1; t.health = 30;
    const turn = vi.spyOn(ai, "take_turn").mockReturnValue([45, 1000, 0]);
    try {
      gs._sync_queue = [0]; gs._sync_advance();
      expect(t.power).toBe(300);
      expect(gs._sync_locks[0]).toEqual([45, 300, 0]);
    } finally { turn.mockRestore(); }
  });
});
