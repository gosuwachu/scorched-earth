/** Additional DOS Lazy Boy DDA checks; supersedes Python steering blends. */
import { it, expect } from "vitest";
import { Config } from "../src/config";
import { Tank, Projectile } from "../src/objects";
import { ITEMS } from "../src/weapons";
import * as guidance from "../src/guidance";
function shot(point: [number, number]) {
  const owner = new Tank(0, "A", 0, 0), cfg = new Config();
  owner.selected_guidance = 37; owner.inventory[37] = 1; owner.guidance_target_pt = point;
  const p = new Projectile(owner, ITEMS[0], 100, 100, 100, 10);
  guidance.attach(owner, cfg, ITEMS[0], p);
  const world = { cfg, tanks: [owner], w: 320, h: 240, terrain: { is_dirt: (_x: number, _y: number) => false } };
  return { p, world };
}
it("Lazy Boy walks exact point with one-pixel major-axis DDA steps", () => {
  const { p, world } = shot([120, 110]);
  for (let i = 1; i <= 20; i++) {
    guidance.lazyStep(p, world);
    expect(p.px).toBe(100+i); expect(p.py).toBeCloseTo(100+i/2);
  }
  expect((p.guidance as guidance.Guidance).arrival).toBe(true);
});
it("Lazy Boy climbs in front of intervening terrain", () => {
  const { p, world } = shot([120, 100]);
  world.terrain.is_dirt = (x, y) => x === 101 && y === 100;
  expect(guidance.lazyStep(p, world)).toEqual([100, 99]);
});
it("Lazy Boy at its destination terminates without a zero-length division", () => {
  const { p, world } = shot([100, 100]);
  expect(guidance.lazyStep(p, world)).toBeNull();
  expect((p.guidance as guidance.Guidance).arrival).toBe(true);
});
it("Lazy Boy climbs around other tanks but flies into the chosen tank", () => {
  const { p, world } = shot([120, 100]);
  const obstacle = new Tank(1, "B", 0, 0);
  obstacle.x = 108; obstacle.y = 100; obstacle.alive = true;
  world.tanks.push(obstacle);
  expect(guidance.lazyStep(p, world)).toEqual([100, 99]);
  p.px = p.sx = 100; p.py = p.sy = 100;
  (p.guidance as guidance.Guidance).target = obstacle;
  expect(guidance.lazyStep(p, world)).toEqual([101, 100]);
});
