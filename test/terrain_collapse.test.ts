import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { Config } from "../src/config";
import { Rng } from "../src/rng";
import { Terrain } from "../src/terrain";

const reference = JSON.parse(readFileSync(new URL("./fixtures/dos_weapons.json", import.meta.url), "utf8"));

describe("terrain collapse after explosions", () => {
  for (const [i, row] of reference.collapse.entries()) {
    it(`matches complete resting geometry for reference column ${i}`, () => {
      const terrain = new Terrain(1, row.input.length);
      terrain.grid.set(row.input);
      terrain._settle_column(0);
      expect(Array.from(terrain.grid)).toEqual(row.output);
      terrain._settle_column(0);
      expect(Array.from(terrain.grid)).toEqual(row.output);
    });
  }

  for (const suspend of [0, 40, 100]) for (const chosen of [true, false]) {
    it(`honors Suspend Dirt=${suspend}, chance=${chosen}, and the affected columns`, () => {
      const terrain = new Terrain(4, 6);
      for (let x = 0; x < 4; x++) terrain.grid.set([0, 88, 0, 89, 0, 90], x * 6);
      const cfg = new Config();
      cfg.SUSPEND_DIRT = suspend;
      const rng = new Rng(1);
      const chance = vi.spyOn(rng, "chance").mockReturnValue(chosen);
      terrain.settle(cfg, rng, 1, 3);
      const falls = suspend === 0 || (suspend === 40 && chosen);
      for (let x = 0; x < 4; x++) {
        expect(Array.from(terrain.grid.slice(x * 6, (x + 1) * 6))).toEqual(
          falls && x >= 1 && x < 3 ? [0, 0, 0, 88, 89, 90] : [0, 88, 0, 89, 0, 90],
        );
      }
      if (suspend === 40) {
        expect(chance).toHaveBeenCalledTimes(1);
        expect(chance).toHaveBeenCalledWith(60, 100);
      } else expect(chance).not.toHaveBeenCalled();
    });
  }
});
