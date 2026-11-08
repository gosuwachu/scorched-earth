import { describe, expect, it } from "vitest";
import { ModernWorld, propContains } from "../src/modern";
import { PARK_PROPS } from "../src/city_parks";

describe("City parks", () => {
  it("keeps real air around swing chains and below the slide", () => {
    expect(propContains("swings", 0, .5)).toBe(false);
    expect(propContains("swings", 0, .95)).toBe(true);
    expect(propContains("playground", .25, .1)).toBe(false);
    expect(propContains("stadium", 0, .6)).toBe(false);
  });
  for (const kind of PARK_PROPS.filter(kind => kind !== "lawn")) it(`${kind}: survives settling, saves and destructive hits`, () => {
    const m = new ModernWorld(320, 300, 17, "GRASS", "CITY");
    m.surface.fill(250);
    for (let x = 0; x < m.fw; x++) m.cells.fill(1, x * m.fh + 500, (x + 1) * m.fh);
    const p = m.stampCityProp(kind, 60, 100, 60, 250);
    const count = () => m.cells.reduce((n, c) => n + Number(c === p.id), 0);
    const before = count();
    m.settle();
    expect(count()).toBeGreaterThan(before * .95);
    const saved = m.serialize();
    expect(ModernWorld.restore(saved, 320, 300).serialize()).toEqual(saved);
    m.circle(p.x, p.y - p.h / 2, 70);
    expect(count()).toBeLessThan(before * .1);
  });
  it("keeps thin playground frames connected at the smallest map scale", () => {
    for (const seed of [1, 2, 19]) {
      const m = ModernWorld.generate(320, 240, seed, { TERRAIN_BIOME: "GRASS", TERRAIN_LAYOUT: "CITY" });
      m.placeProps([]);
      const equipment = m.props.filter(p => p.kind === "swings" || p.kind === "playground" || p.kind === "stadium");
      const count = (id: number) => m.cells.reduce((n, c) => n + Number(c === id), 0);
      const before = equipment.map(p => count(p.id));
      m.settle();
      equipment.forEach((p, i) => expect(count(p.id)).toBeGreaterThan(before[i] * .95));
    }
  });
  it("generates repeatable planted parks and includes sports grounds across seeds", () => {
    const kinds = new Set<string>();
    for (const seed of [1, 2, 19, 71, 313]) {
      const make = () => {
        const m = ModernWorld.generate(640, 480, seed, { TERRAIN_BIOME: "GRASS", TERRAIN_LAYOUT: "CITY" });
        m.placeProps([]);
        return m;
      };
      const m = make();
      expect(m.serialize()).toEqual(make().serialize());
      expect(m.props.filter(p => p.kind === "tree").length).toBeGreaterThanOrEqual(2);
      expect(m.props.some(p => p.kind === "swings")).toBe(true);
      for (const p of m.props) kinds.add(p.kind);
      expect(Buffer.from(ModernWorld.restore(m.serialize(), 640, 480).cells).equals(Buffer.from(m.cells))).toBe(true);
    }
    expect(kinds.has("stadium")).toBe(true);
  });
});
