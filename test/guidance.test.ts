/** DOS reference replaces the old Python blend/radius/ballistic vectors. */
import { describe, it, expect } from "vitest";
import reference from "./fixtures/dos_guidance.json";
import * as g from "../src/guidance";
import { Config } from "../src/config";
import { Tank, Projectile } from "../src/objects";
import { ITEMS } from "../src/weapons";

function setup(slot = 33) {
  const cfg = new Config(), owner = new Tank(0, "A", 0, 1), target = new Tank(1, "B", 0, 1);
  owner.x = 20; owner.y = 100; owner.selected_guidance = slot; owner.inventory[slot] = 1;
  target.x = 130; target.y = 100;
  owner.guidance_target_pt = [target.x, target.y]; owner.guidance_target = target;
  const p = new Projectile(owner, ITEMS[0], 100, 100, 20, -10);
  const world = { cfg, tanks: [owner, target], w: 320, h: 240, terrain: { is_dirt: () => false } };
  g.attach(owner, cfg, ITEMS[0], p);
  return { cfg, owner, target, p, world };
}
describe("DOS guidance", () => {
  it("extracts constants from the checksum-verified DOS image", () => {
    expect(g.HEAT_RANGE).toBe(reference.constants.heat_range);
    expect(g.LAZY_SPEED).toBe(reference.constants.lazy_speed);
    expect(g.GUIDANCE_ACCEL).toBe(reference.constants.heat_vertical_accel);
  });
  for (const sample of reference.steering) it(`callback ${sample.slot}, delta ${sample.delta}`, () => {
    const { p, cfg } = setup(sample.slot), state = p.guidance as g.Guidance;
    state.armed = true; state.point = [p.px + sample.delta[0], p.py + sample.delta[1]];
    [p.vx, p.vy] = sample.velocity;
    g.apply(p, cfg);
    expect(p.vx).toBeCloseTo(sample.result[0], 10); expect(p.vy).toBeCloseTo(sample.result[1], 10);
  });
  for (const sample of reference.ballistic) it(`wind-corrected power ${sample.angle}/${sample.wind}`, () => {
    const { owner, cfg } = setup(34);
    owner.x = 400; owner.y = 500; owner.angle = sample.angle; cfg.wind = sample.wind;
    owner.guidance_target_pt = sample.target;
    expect(g.solve_ballistic_power_launch(cfg, owner, ITEMS[0])).toBe(sample.power);
  });
  it("Heat locks first live non-owner in range, including teammates, rather than nearest", () => {
    const { world, p, target } = setup();
    const nearer = new Tank(2, "C", 0, 0); nearer.x = 102; nearer.y = 100;
    world.tanks.push(nearer);
    expect(g.visit(p, world, 100, 100)).toBe(true);
    expect((p.guidance as g.Guidance).target).toBe(target);
    target.x = 200;
    expect((p.guidance as g.Guidance).point).toEqual([130, 100]);
  });
  it("Heat uses strict rounded distance < 40 and skips dead tanks", () => {
    const { world, p, target } = setup();
    target.x = 140;
    expect(g.visit(p, world, 100, 100)).toBe(false);
    target.x = 139; target.alive = false;
    expect(g.visit(p, world, 100, 100)).toBe(false);
    target.alive = true;
    expect(g.visit(p, world, 100, 100)).toBe(true);
  });
  for (const slot of [35, 36]) it(`arms ${slot} at the swept target axis, preserves velocity`, () => {
    const { p, world } = setup(slot);
    expect(g.visit(p, world, slot === 36 ? 130 : 100, slot === 35 ? 99 : 70)).toBe(slot === 36);
    if (slot === 35) expect(g.visit(p, world, 100, 100)).toBe(true);
    expect([p.vx, p.vy]).toEqual([20, -10]);
    expect((p.guidance as g.Guidance).armed).toBe(true);
  });
  for (const slot of [33, 35, 36]) it(`axis overshoot ${slot} releases Heat or detonates targeted guidance`, () => {
    const { p, cfg } = setup(slot), state = p.guidance as g.Guidance;
    state.armed = true; state.directionX = -1; state.point = [90, 100];
    expect(g.apply(p, cfg)).toBe(slot === 33);
    if (slot === 33) expect(p.guidance).toBeNull(); else expect(state.arrival).toBe(true);
  });
  it("does not arm unsupported, depleted, invalid or simultaneous guidance", () => {
    for (const weapon of [6, 7, 15, 16, 31]) {
      const { owner, cfg, p } = setup(); expect(g.attach(owner, cfg, ITEMS[weapon], p)).toBeNull();
    }
    const { owner, cfg, p } = setup(); owner.inventory[33] = 0;
    expect(g.attach(owner, cfg, ITEMS[0], p)).toBeNull(); owner.inventory[33] = 1;
    cfg.PLAY_MODE = "SIMULTANEOUS"; expect(g.attach(owner, cfg, ITEMS[0], p)).toBeNull();
  });
  it("Ballistic caps power by health and ignores viscosity", () => {
    const { owner, cfg } = setup(34); owner.angle = 45; owner.health = 10;
    expect(g.solve_ballistic_power_launch(cfg, owner, ITEMS[0])).toBeLessThanOrEqual(100);
    const before = g.solve_ballistic_power_launch(cfg, owner, ITEMS[0]); cfg.AIR_VISCOSITY = 20;
    expect(g.solve_ballistic_power_launch(cfg, owner, ITEMS[0])).toBe(before);
    owner.guidance_target_pt = owner.guidance_target = null;
    expect(g.solve_ballistic_power_launch(cfg, owner, ITEMS[0])).toBeNull();
  });
});
