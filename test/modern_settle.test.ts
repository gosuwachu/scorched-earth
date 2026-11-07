/** Modern material rules are browser features, not DOS fidelity fixtures. */
import { describe, expect, it } from "vitest";
import { ModernWorld } from "../src/modern";
import { Terrain } from "../src/terrain";
import { Config } from "../src/config";
import { Rng } from "../src/rng";

function world(rows: string[], cave = false): ModernWorld {
  const m = new ModernWorld(rows[0].length / 2, rows.length / 2, 1, "GRASS", cave ? "CAVE" : "MOUNTAINS");
  rows.forEach((row, y) => [...row].forEach((c, x) => { m.cells[x * m.fh + y] = Number(c); }));
  m.publish(0, 0, m.fw, m.fh);
  return m;
}
function rows(m: ModernWorld): string[] {
  return Array.from({ length: m.fh }, (_, y) => Array.from({ length: m.fw }, (_, x) => m.cells[x * m.fh + y]).join(""));
}
function settled(m: ModernWorld, expected: string[]): void {
  const volume = m.cells.reduce((n, c) => n + Number(c !== 0), 0);
  m.settle();
  expect(rows(m)).toEqual(expected);
  expect(m.cells.reduce((n, c) => n + Number(c !== 0), 0)).toBe(volume);
  // Force another support computation, rather than testing the clean-cache exit.
  m.publish(0, 0, m.fw, m.fh);
  m.settle();
  expect(rows(m)).toEqual(expected);
  for (let x = 0; x < m.w; x++) for (let y = 0; y < m.h; y++) {
    expect(m.grid[x * m.h + y] !== 0).toBe(m.solid(x, y) || m.solid(x + .5, y) || m.solid(x, y + .5) || m.solid(x + .5, y + .5));
  }
}

describe("Modern material collapse", () => {
  it("drops natural dirt attached sideways to a grounded pillar", () => {
    settled(world(["000000", "211110", "200000", "200000", "200000", "222222"]),
      ["000000", "200000", "200000", "200000", "233330", "222222"]);
  });
  it("retains a rock bridge, then drops it when its last support is removed", () => {
    const m = world(["000000", "222220", "200000", "200000", "200000", "222222"]);
    settled(m, rows(m));
    m.cells[2] = 0; m.publish(0, 2, 1, 3);
    settled(m, ["000000", "000000", "300000", "200000", "233330", "222222"]);
  });
  for (const material of [1, 3]) it(`lets grounded soil ${material} support rock without becoming a sideways brace`, () => {
    const m = world(["000000", "022220", `0${material}0000`, `0${material}0000`, `0${material}0000`, "222222"]);
    settled(m, rows(m));
  });
  it("drops dirt hanging from a cave ceiling while retaining attached rock", () => {
    settled(world(["222222", "012210", "000000", "000000", "000000", "222222"], true),
      ["222222", "002200", "000000", "000000", "030030", "222222"]);
  });
  it("does not let falling dirt anchor rock and ignores Classic suspension settings", () => {
    const m = world(["000000", "211220", "200000", "200000", "200000", "222222"]);
    const terrain = new Terrain(m.w, m.h);
    terrain.modern = m; terrain.grid = m.grid;
    terrain.begin_settle(Object.assign(new Config(), { SUSPEND_DIRT: 100 }), new Rng(1));
    expect(terrain.step_settle()).toBe(true);
    expect(rows(m)).toEqual(["000000", "200000", "200000", "200000", "233330", "222222"]);
  });
});
