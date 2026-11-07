import { describe, expect, it } from "vitest";
import { ModernWorld, propContains } from "../src/modern";
import { CITY_BUILDINGS } from "../src/city_shapes";
import { PAINTED_ART, paintedAspect, buildingMasks } from "../src/painted_sprites";
const buildings = [...CITY_BUILDINGS, "house", "tower"] as const;
const scenery = [...buildings, "pine", "tree", "cactus"] as const;

function fixture(kind: typeof scenery[number]) {
  const m = new ModernWorld(320, 300, 17, "GRASS", "CITY");
  m.surface.fill(250);
  for (let x = 0; x < m.fw; x++) m.cells.fill(2, x * m.fh + 500, (x + 1) * m.fh);
  const p = m.stampCityProp(kind, 60, 200, 180);
  return { m, p };
}
describe("Painted scenery, landmarks and crossings", () => {
  for (const kind of scenery) it(`${kind}: connected destructible silhouette and save restoration`, () => {
    const { m, p } = fixture(kind);
    const count = () => m.cells.reduce((sum, cell) => sum + (cell === p.id ? 1 : 0), 0);
    const before = count();
    expect(before).toBeGreaterThan(200);
    expect(p.art).toBe(PAINTED_ART);
    expect(p.w / p.h).toBeCloseTo(paintedAspect(kind)!, 12);
    m.settle();
    expect(count()).toBeGreaterThan(before * .98);
    const restored = ModernWorld.restore(m.serialize(), m.w, m.h);
    expect(Buffer.from(restored.cells).equals(Buffer.from(m.cells))).toBe(true);
    expect(restored.props).toEqual(m.props);
    // Removing every foundation must release the entire connected structure,
    // including the wheel rim and suspended bridge cables.
    for (let x = 58 * 2; x <= 262 * 2; x++) m.cells.fill(0, x * m.fh + 490, x * m.fh + 506);
    m.publish(0, 0, m.fw, m.fh); m.settle();
    expect(count()).toBe(0);
  });
  for (const kind of ["bridge", "golden_gate"] as const) it(`${kind}: an open span remains traversable by a projectile sweep`, () => {
    const { m, p } = fixture(kind); m.settle();
    const y = p.y - p.h * .1;
    // Stay between the suspension piers / stone abutments.
    expect([...m.sweep(p.x - p.w * .2, y, p.x + p.w * .2, y)].every(([x, yy]) => !m.solid(x, yy))).toBe(true);
    expect(m.solid(p.x, p.y - p.h * (buildingMasks[kind]!.deck! - .04))).toBe(true);
  });
  it("the London Eye has real air between its spokes", () => {
    let air = 0, solid = 0;
    for (let y = .3; y <= .8; y += .01) for (let x = -.3; x <= .3; x += .01) {
      if (propContains("london_eye", x, y)) solid++; else air++;
    }
    expect(air).toBeGreaterThan(solid);
    expect(solid).toBeGreaterThan(50);
  });
  it("fits both axes together when plots or map headroom constrain buildings", () => {
    for (const kind of scenery) for (const [w, height, baseY] of [[30, 300, 250], [200, 50, 250], [200, 300, 100]]) {
      const { m } = fixture(kind);
      const p = m.stampCityProp(kind, 60, w, height, baseY);
      expect(p.w).toBeLessThanOrEqual(w + 1e-10);
      expect(p.h).toBeLessThanOrEqual(Math.min(height, baseY - 65));
      expect(p.w / p.h).toBeCloseTo(paintedAspect(kind)!, 12);
    }
  });
  it("retains earlier artwork versions when restoring saved worlds", () => {
    const { m, p } = fixture("st_pauls");
    p.art = "illustrated-v1";
    expect(ModernWorld.restore(m.serialize(), m.w, m.h).props[0].art).toBe("illustrated-v1");
  });
});
