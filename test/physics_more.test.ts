/** Launch uses DOS-derived power fixtures; wall fallback remains a contract test. */
import { describe, it, expect } from "vitest";
import * as physics from "../src/physics";
import { Projectile, Tank } from "../src/objects";
import { ITEMS } from "../src/weapons";
import { Config } from "../src/config";
import reference from "./fixtures/dos_guidance.json";

function mkCfg(gravity = 0.2, wind = 0): Config {
  const cfg = new Config();
  cfg.GRAVITY = gravity;
  cfg.AIR_VISCOSITY = 0;
  cfg.live_elastic = cfg.elastic;
  cfg.wind = wind;
  return cfg;
}

describe("physics(more): launch-time Ballistic power solve", () => {
  for (const sample of reference.ballistic) {
    it(`launch at ${sample.angle} degrees with wind ${sample.wind}`, () => {
      const cfg = mkCfg(0.2, sample.wind);
      const t = new Tank(0, "P0", 0, 0);
      t.x = 400; t.y = 500; t.angle = sample.angle; t.power = 500;
      t.selected_guidance = 34; t.inventory[34] = 1; t.guidance_target_pt = sample.target;
      const proj = physics.launch(t, cfg, ITEMS[0]);
      const rad = sample.angle * 0.017453293;
      expect(proj.vx).toBeCloseTo(sample.power * Math.cos(rad), 12);
      expect(proj.vy).toBeCloseTo(sample.power * Math.sin(rad), 12);
    });
  }

  it("angle omitted (null) uses the tank's current firing angle", () => {
    // Covers the `if (angle === null) angle = tank.angle` default: an explicit
    // angle equal to tank.angle must produce byte-identical launch state.
    const cfg = mkCfg(0.2, 0);
    const t = new Tank(0, "P0", 0, 0);
    t.x = 300;
    t.y = 500;
    t.angle = 37;
    t.power = 640;
    const a = physics.launch(t, cfg, ITEMS[0], 640, null);
    const b = physics.launch(t, cfg, ITEMS[0], 640, 37);
    expect([a.vx, a.vy, a.px, a.py, a.sx, a.sy]).toEqual([
      b.vx,
      b.vy,
      b.px,
      b.py,
      b.sx,
      b.sy,
    ]);
    // sanity: a non-trivial 37-degree shot, not the (cos45) default.
    expect(a.vx).toBeGreaterThan(0);
  });

  it("depleted Ballistic selection falls back to the chosen power", () => {
    const t = new Tank(0, "P0", 0, 0);
    t.selected_guidance = 34; t.inventory[34] = 0; t.guidance_target_pt = [600, 500];
    t.angle = 45; t.power = 123;
    const proj = physics.launch(t, mkCfg(), ITEMS[0]);
    expect(Math.hypot(proj.vx, proj.vy)).toBeCloseTo(123, 12);
    expect(proj.guidance).toBeNull();
  });
});

describe("physics(more): handle_walls falls back to cfg.elastic when live_elastic absent", () => {
  it("live_elastic-absent == live_elastic set to cfg.elastic (RUBBER floor bounce)", () => {
    function run(deleteLive: boolean): [boolean, number, number, number, number, number] {
      const cfg = mkCfg();
      cfg.ELASTIC = "RUBBER"; // enum index 3
      // re-derive elastic getter base; live_elastic mirrors __post_init__
      cfg.live_elastic = cfg.elastic;
      if (deleteLive) {
        delete (cfg as unknown as { live_elastic?: number }).live_elastic;
      }
      const p = new Projectile(null, ITEMS[0], 100.0, 150 + 1, 5.0, -200.0);
      p.guidance = null;
      const alive = physics.handle_walls(p, cfg, 200, 150);
      return [alive, p.px, p.py, p.vx, p.vy, p.bounce_count];
    }
    const withLive = run(false);
    const noLive = run(true);
    expect(noLive).toEqual(withLive);
    // and the bounce actually happened (not a degenerate both-null compare)
    expect(withLive[5]).toBe(1);
    expect(withLive[0]).toBe(true);
  });
});
