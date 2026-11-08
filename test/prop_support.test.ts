/** Modern scenery placement checks, independent of DOS behavior. */
import { describe, expect, it } from "vitest";
import { ModernWorld, propContains, type Prop } from "../src/modern";

function ground(layout: "CITY" | "MOUNTAINS") {
  const m = new ModernWorld(640, 480, 71, "SWAMP", layout);
  for (let x = 0; x < m.fw; x++) {
    // A narrow depression bypasses an endpoint-only slope check and is
    // deeper than the old eighteen-world-unit foundation limit.
    const top = 320 + Math.floor(x / 80) + (x % 100 > 40 && x % 100 < 60 ? 50 : 0);
    m.surface[x] = top;
    m.cells.fill(1, x * m.fh + top * 2, (x + 1) * m.fh);
  }
  return m;
}
function feet(m: ModernWorld, p: Prop): Array<[number, number]> {
  const result: Array<[number, number]> = [];
  for (let x = Math.ceil((p.x - p.w / 2) * 2); x < (p.x + p.w / 2) * 2; x++) {
    let foot = -1;
    for (let y = Math.floor((p.y - p.h) * 2); y < p.y * 2; y++) {
      if (propContains(p.kind, (x / 2 - p.x) / p.w, (p.y - y / 2) / p.h)) foot = y;
    }
    if (foot >= (p.y - Math.max(.5, p.h * .05)) * 2) result.push([x, foot]);
  }
  expect(result.length).toBeGreaterThan(0);
  return result;
}
function supported(m: ModernWorld, p: Prop) {
  for (const [x, foot] of feet(m, p)) {
    for (let y = foot + 1; y < 400 * 2; y++) expect(m.cells[x * m.fh + y], `${p.kind} at ${x / 2}, ${y / 2}`).toBeGreaterThan(0);
  }
}
describe("Scenery ground support", () => {
  for (const kind of ["house", "detached", "tree", "pine", "cactus"] as const) {
    it(`${kind}: supports every base column across slopes and deep depressions`, () => {
      const m = ground("CITY");
      const p = m.stampCityProp(kind, 80, 120, 100);
      supported(m, p);
      if (["tree", "pine", "cactus"].includes(kind)) {
        const base = feet(m, p);
        const top = Math.min(...base.map(([, y]) => y + 1));
        for (let x = base[0][0]; x <= base[base.length - 1][0]; x++) {
          expect(m.surface[x]).toBe(top / 2);
          for (let y = top; y < 400 * 2; y++) expect(m.cells[x * m.fh + y]).not.toBe(2);
        }
      }
      const restored = ModernWorld.restore(m.serialize(), m.w, m.h);
      expect(restored.cells).toEqual(m.cells);
    });
  }
  it("also seats countryside houses and trees using continuous support", () => {
    const m = ground("MOUNTAINS");
    m.placeProps([]);
    expect(m.props.some(p => p.kind === "house")).toBe(true);
    expect(m.props.some(p => p.kind === "tree")).toBe(true);
    for (const p of m.props) supported(m, p);
  });
});
