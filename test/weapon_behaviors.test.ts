/**
 * Differential gate: TS weapon_behaviors == Python scorch.weapon_behaviors
 * (the byte-verified oracle).
 *
 * Golden vectors are produced by oracle/dump_weapon_behaviors.py from the Python
 * port and written to oracle/vectors/weapon_behaviors.json. The Python dumper
 * drives the REAL scorch.weapon_behaviors functions over lightweight mock
 * Tank/Cfg/Terrain/Rng/Projectile/State objects; this test builds STRUCTURALLY
 * IDENTICAL mocks (same fields, same terrain surface profiles, same callback
 * logging, same delta-cell terrain snapshot) and asserts src/weapon_behaviors.ts
 * reproduces every result.
 *
 * EPSILON POLICY:
 *   Every position / index / pixel / depth / health / shield / count / boolean /
 *   string output is an INTEGER, boolean, string, or an exactly-representable
 *   float (eff_radius = abs(blast)*scale over the {1.0,1.5,2.0} scalars; all
 *   recorded px/py are produced by integer arithmetic) and is asserted EXACT
 *   (.toBe / .toEqual).
 *
 *   The ONLY transcendental-derived floats in the battery are the laser beam
 *   DIRECTION (ang = atan2(vy,vx), cos(ang), -sin(ang)).  V8 Math.{atan2,cos,sin}
 *   and CPython math.{...} agree to <=1 ULP for these inputs; the recorded raw
 *   direction floats are asserted within 1e-12 (.toBeCloseTo(_, 12)) per the
 *   brief's rule for sqrt/trig-derived floats.  The INTEGER pixel PATH the beam
 *   marches (int(x),int(y) accumulated by x+=cos, y+=-sin) is asserted EXACT --
 *   it is stable across the <=1 ULP direction split for every angle in the
 *   battery (MEASURED 0 pixel-path mismatches), which is the load-bearing result.
 *   math.hypot in funky/napalm/nearest_tank is over INTEGER coords, so the port's
 *   Math.sqrt(dx*dx+dy*dy) is bit-exact (damage.ts NUMERIC NOTES) and the
 *   dependent damage integers are asserted EXACT.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import * as wb from "../src/weapon_behaviors";
import type { BState, BTank, BTerrain, BProjectile } from "../src/weapon_behaviors";
import * as damage from "../src/damage";
import { Rng } from "../src/rng";
import * as C from "../src/constants";
import { ITEMS, Item } from "../src/weapons";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VECTORS = join(__dirname, "..", "oracle", "vectors", "weapon_behaviors.json");

// ===========================================================================
// Mocks -- mirror oracle/dump_weapon_behaviors.py exactly.
// ===========================================================================
interface MockTank extends BTank {
  id: string;
}
function mkTank(
  id: string,
  o: Partial<MockTank> = {}
): MockTank {
  return {
    id,
    x: o.x ?? 100,
    y: o.y ?? 100,
    half_width: o.half_width ?? 7,
    health: o.health ?? 100,
    power: o.power ?? 500,
    shield_hp: o.shield_hp ?? 0,
    shield_item: o.shield_item ?? 0,
    shield_laserproof: o.shield_laserproof ?? false,
    alive: o.alive ?? true,
    player_index: o.player_index ?? 0,
    team_id: o.team_id ?? 0,
    angle: o.angle ?? 90,
    score: o.score ?? 0,
    cash: o.cash ?? 0,
    win_counter: o.win_counter ?? 0,
    inventory: o.inventory ? o.inventory.slice() : [],
    hits_this_round: {},
    hits_career: {},
    // damage.Tank fields the explode path may touch but the behaviors never set:
    parachute_deployed: false,
    parachutes: 0,
    parachute_threshold: 5,
  } as MockTank;
}

class MockCfg {
  scoring = C.SCORING_STANDARD;
  team_mode = C.TEAM_NONE;
  private _sound: boolean;
  constructor(sound = true) {
    this._sound = sound;
  }
  is_on(key: string): boolean {
    if (key === "SOUND") return this._sound;
    return false;
  }
}

type Surface = (x: number) => number;

class MockTerrain implements BTerrain {
  w: number;
  h: number;
  grid = new Map<string, number>();
  baseline = new Map<string, number>();
  carve_circles: number[][] = [];
  deposit_circles: number[][] = [];
  carve_wedges: number[][] = [];
  settles: Array<[number, number | null]> = [];
  constructor(w = 360, h = 480, surface?: Surface) {
    this.w = w;
    this.h = h;
    if (surface !== undefined) {
      for (let x = 0; x < w; x++) {
        let top = surface(x);
        top = Math.max(0, Math.min(h, top));
        for (let y = top; y < h; y++) {
          this.grid.set(key(x, y), C.COL_DIRT);
        }
      }
    }
    this.baseline = new Map(this.grid);
  }
  read(x: number, y: number): number {
    if (0 <= x && x < this.w && 0 <= y && y < this.h) {
      return this.grid.get(key(x, y)) ?? C.COL_SKY;
    }
    return C.COL_SKY;
  }
  write(x: number, y: number, color: number): void {
    if (0 <= x && x < this.w && 0 <= y && y < this.h) {
      this.grid.set(key(x, y), color);
    }
  }
  is_dirt(x: number, y: number): boolean {
    return C.is_dirt(this.read(x, y));
  }
  is_solid(x: number, y: number): boolean {
    return C.is_solid(this.read(x, y));
  }
  column_top(x: number): number {
    // Faithful re-implementation of scorch.terrain.Terrain.column_top
    // (numpy argmax logic, no numpy). MUST match the oracle's MockTerrain.
    if (!(0 <= x && x < this.w)) return this.h;
    const solid: boolean[] = [];
    for (let y = 0; y < this.h; y++) solid.push(this.is_solid(x, y));
    if (!solid[0]) {
      for (let idx = 0; idx < this.h; idx++) if (solid[idx]) return idx;
      return this.h;
    }
    let gap = this.h;
    for (let y = 0; y < this.h; y++) {
      if (!solid[y]) {
        gap = y;
        break;
      }
    }
    if (gap >= this.h) return this.h;
    for (let idx = gap; idx < this.h; idx++) if (solid[idx]) return idx;
    return this.h;
  }
  // damage.Terrain requires is_supported; the weapon behaviors never call it
  // (it is on the fall-damage path, not detonation), so a no-op false suffices
  // to satisfy the structural type. Never affects a weapon_behaviors result.
  is_supported(_x: number, _y: number, _half_width: number): boolean {
    return false;
  }
  carve_circle(cx: number, cy: number, r: number): void {
    this.carve_circles.push([Math.trunc(cx), Math.trunc(cy), Math.trunc(r)]);
  }
  deposit_circle(cx: number, cy: number, r: number): void {
    this.deposit_circles.push([cx, cy, r]);
  }
  carve_wedge(cx: number, cy: number, r: number, half_angle_deg: number, aim_deg: number): void {
    this.carve_wedges.push([cx, cy, r, half_angle_deg, aim_deg]);
  }
  settle(_cfg: unknown, _rng: unknown, x_lo = 0, x_hi: number | null = null): void {
    this.settles.push([x_lo, x_hi]);
  }
  /** Delta cells vs the pristine surface baseline -- mirrors _terrain_snap. */
  deltaCells(): number[][] {
    const changed: number[][] = [];
    for (const [k, c] of this.grid) {
      const base = this.baseline.get(k) ?? C.COL_SKY;
      if (base !== c) {
        const [x, y] = unkey(k);
        changed.push([x, y, c]);
      }
    }
    for (const [k, c] of this.baseline) {
      if (!this.grid.has(k) && c !== C.COL_SKY) {
        const [x, y] = unkey(k);
        changed.push([x, y, C.COL_SKY]);
      }
    }
    changed.sort(cmp3);
    return changed;
  }
}

function key(x: number, y: number): string {
  return x + "," + y;
}
function unkey(k: string): [number, number] {
  const i = k.indexOf(",");
  return [Number(k.slice(0, i)), Number(k.slice(i + 1))];
}
/** Mirror Python's sorted() on [x,y,c] lists: lexicographic by x then y then c. */
function cmp3(a: number[], b: number[]): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

class MockProj implements BProjectile {
  weapon: Item;
  owner: BTank | null;
  px: number;
  py: number;
  vx: number;
  vy: number;
  sx: number;
  sy: number;
  active = true;
  split_done = false;
  warheads_left: number;
  state: { [k: string]: unknown } = {};
  trail: unknown[] = [];
  constructor(
    weapon: Item,
    o: { owner?: BTank | null; px?: number; py?: number; vx?: number; vy?: number; energy?: number } = {}
  ) {
    this.weapon = weapon;
    this.owner = o.owner ?? null;
    this.px = o.px ?? 0.0;
    this.py = o.py ?? 0.0;
    this.vx = o.vx ?? 0.0;
    this.vy = o.vy ?? 0.0;
    this.sx = damage.pyRound(this.px);
    this.sy = damage.pyRound(this.py);
    this.warheads_left = weapon.warheads;
    if (o.energy !== undefined) this.state["energy"] = o.energy;
  }
}

class MockState implements BState {
  cfg: MockCfg;
  tanks: MockTank[];
  terrain: MockTerrain;
  rng: Rng;
  explosion_scale: number;
  current_shooter: MockTank | null;
  current_weapon: unknown;
  economy = { unit_price: (slot: number) => slot };
  projectiles: BProjectile[] = [];
  explosions: Array<[number, number, number, boolean, boolean]> = [];
  plasma_rings: number[][] = [];
  beams: Array<Array<[number, number]>> = [];
  destroyed: Array<[string, boolean]> = [];
  digger_cycles = 0;
  constructor(o: {
    cfg?: MockCfg;
    tanks?: MockTank[];
    terrain?: MockTerrain;
    rng?: Rng;
    explosion_scale?: number;
    current_shooter?: MockTank | null;
    current_weapon?: unknown;
  } = {}) {
    this.cfg = o.cfg ?? new MockCfg();
    this.tanks = o.tanks ?? [];
    this.terrain = o.terrain ?? new MockTerrain();
    this.rng = o.rng ?? new Rng(0);
    this.explosion_scale = o.explosion_scale ?? 1.0;
    this.current_shooter = o.current_shooter ?? null;
    this.current_weapon = o.current_weapon ?? null;
  }
  add_explosion(x: number, y: number, r: number, kw?: { [k: string]: unknown }): void {
    const dirt_only = Boolean(kw?.["dirt_only"]);
    const nuke = Boolean(kw?.["nuke"]);
    this.explosions.push([Math.trunc(x), Math.trunc(y), Math.trunc(r), dirt_only, nuke]);
  }
  add_plasma_ring(x: number, y: number, max_r: number): void {
    this.plasma_rings.push([x, y, max_r]);
  }
  add_beam(pts: Array<[number, number]>): void {
    this.beams.push(pts.map((p) => [p[0], p[1]] as [number, number]));
  }
  on_tank_destroyed(victim: damage.Tank, weapon: unknown): void {
    this.destroyed.push([(victim as MockTank).id, weapon !== null && weapon !== undefined]);
  }
  start_digger_cycle(): void {
    this.digger_cycles += 1;
  }
}

// ---------------------------------------------------------------------------
// Surface profiles -- mirror the oracle's _surf_* callables exactly (integer
// math identical to Python).
// ---------------------------------------------------------------------------
const surfFlat = (top: number): Surface => () => top;
const surfValley = (center: number, floor: number, rim: number, half: number): Surface =>
  (x: number) => {
    const d = Math.abs(x - center);
    if (d >= half) return rim;
    return Math.trunc(floor - ((floor - rim) * d) / half);
  };
const surfSlope = (top0: number, slope: number): Surface =>
  (x: number) => Math.trunc(top0 + slope * x);
const surfBasin = (center: number, floor: number, wall: number, half: number): Surface =>
  (x: number) => {
    const d = Math.abs(x - center);
    if (d <= half) return floor;
    return wall;
  };

// ---------------------------------------------------------------------------
// Snapshot helpers -- mirror the oracle's _tank_snap exactly.
// ---------------------------------------------------------------------------
type TSnap = [number, number, number, boolean, number, number, number];
function tsnap(t: MockTank): TSnap {
  return [t.health, t.shield_hp, t.shield_item, t.alive, t.score, t.cash, t.win_counter];
}
function expectTSnap(got: TSnap, want: TSnap, label: string): void {
  expect(got[0], `${label} health`).toBe(want[0]);
  expect(got[1], `${label} shield_hp`).toBe(want[1]);
  expect(got[2], `${label} shield_item`).toBe(want[2]);
  expect(got[3], `${label} alive`).toBe(want[3]);
  expect(got[4], `${label} score`).toBe(want[4]);
  expect(got[5], `${label} cash`).toBe(want[5]);
  expect(got[6], `${label} win_counter`).toBe(want[6]);
}

type TerrSnap = {
  carve_circles: number[][];
  deposit_circles: number[][];
  carve_wedges: number[][];
  settles: Array<[number, number | null]>;
  cells: number[][];
};
function expectTerrain(t: MockTerrain, want: TerrSnap, label: string): void {
  expect(t.carve_circles, `${label} carve_circles`).toEqual(want.carve_circles);
  expect(t.deposit_circles, `${label} deposit_circles`).toEqual(want.deposit_circles);
  expect(t.carve_wedges, `${label} carve_wedges`).toEqual(want.carve_wedges);
  expect(t.settles, `${label} settles`).toEqual(want.settles);
  expect(t.deltaCells(), `${label} cells`).toEqual(want.cells);
}

type StateSnap = {
  explosions: Array<[number, number, number, boolean, boolean]>;
  plasma_rings: number[][];
  beams: number[][][];
  destroyed: Array<[string, boolean]>;
  digger_cycles: number;
  current_weapon_name: string | null;
};
function expectState(st: MockState, want: StateSnap, label: string): void {
  expect(st.explosions, `${label} explosions`).toEqual(want.explosions);
  expect(st.plasma_rings, `${label} plasma_rings`).toEqual(want.plasma_rings);
  expect(st.beams, `${label} beams`).toEqual(want.beams);
  expect(st.destroyed, `${label} destroyed`).toEqual(want.destroyed);
  expect(st.digger_cycles, `${label} digger_cycles`).toBe(want.digger_cycles);
  expect(
    (st.current_weapon as Item | null)?.name ?? null,
    `${label} current_weapon_name`
  ).toBe(want.current_weapon_name);
}

// ===========================================================================
// Vector typing
// ===========================================================================
type V = {
  module: string;
  consts: Array<{ fn: string; LASER_BLEED: number; RIOT_WEDGE_HALF_charge: number; RIOT_WEDGE_HALF_blast: number }>;
  eff_radius: Array<{ idx: number; name: string; scale: number; out: number }>;
  detonate: Array<{
    idx: number; name: string; behavior: string; scale: number; sound: boolean;
    enemy: TSnap; far: TSnap; terrain: TerrSnap; state: StateSnap;
  }>;
  funky: Array<{
    seed: number; scale: number; near: TSnap;
    explosions: Array<[number, number, number, boolean, boolean]>;
    carve_circles: number[][]; destroyed: Array<[string, boolean]>;
  }>;
  napalm: Array<{
    idx: number; name: string; terr: string; scale: number;
    t0: TSnap; t1: TSnap; t2: TSnap;
    explosions: Array<[number, number, number, boolean, boolean]>; carve_circles: number[][];
  }>;
  pool_depth: Array<{ terr: string; x: number; r: number; out: number }>;
  nearest_tank: Array<{ qx: number; qy: number; best: string | null }>;
  dirt_sphere: Array<{ idx: number; name: string; scale: number; terrain: TerrSnap }>;
  dirt_slump: Array<{ scale: number; terrain: TerrSnap }>;
  dirt_wedge: Array<{ scale: number; name: string; terrain: TerrSnap }>;
  dirt_settle: Array<{ scale: number; terrain: TerrSnap }>;
  riot_sphere: Array<{
    idx: number; name: string; scale: number; terrain: TerrSnap;
    explosions: Array<[number, number, number, boolean, boolean]>;
  }>;
  riot_wedge: Array<{ idx: number; name: string; scale: number; aim: number | string; terrain: TerrSnap }>;
  plasma: Array<{
    scale: number; enemy: TSnap; terrain: TerrSnap; plasma_rings: number[][];
    explosions: Array<[number, number, number, boolean, boolean]>; current_weapon_name: string;
  }>;
  popcorn: Array<{
    seed: number; scale: number; enemy: TSnap;
    explosions: Array<[number, number, number, boolean, boolean]>; carve_circles: number[][];
  }>;
  dirt_tower: Array<{ scale: number; terrain: TerrSnap }>;
  single_warhead: Array<{
    idx: number; child_idx: number; child_name: string; child_blast: number;
    child_behavior: string; child_warheads: number; child_fan: number;
    parent_behavior: string; parent_warheads: number;
  }>;
  mirv: Array<{
    idx: number; name: string; pvx: number; pvy: number;
    proj_active: boolean; proj_split_done: boolean; n_children: number;
    children: Array<[string, number, number, number, number, number, number, number, boolean, string | null]>;
  }>;
  roller: Array<{
    idx: number; name: string; terr: string; startx: number; dir: number;
    steps: number; path: Array<Array<number | boolean | null>>; active: boolean;
    tank: TSnap; carve_circles: number[][];
    explosions: Array<[number, number, number, boolean, boolean]>; current_weapon_name: string | null;
  }>;
  digger: Array<{
    idx: number; name: string; bore_half: number; max_depth: number; depth: number;
    steps: number; active: boolean; positions: Array<Array<number | boolean>>;
    digger_cycles: number; terrain: TerrSnap;
  }>;
  sandhog: Array<{
    idx: number; name: string; mode: string; has_enemy: boolean; target_x: number;
    start_y: number; warheads_left: number; depth: number; steps: number; active: boolean;
    positions: Array<Array<number | boolean | null>>; digger_cycles: number;
    shooter: TSnap; current_weapon_name: string | null; enemy?: TSnap; enemy2?: TSnap;
  }>;
  laser: Array<{
    vx: number; vy: number; energy: number; ang: number; cos: number; neg_sin: number;
    n_pts: number; trail: number[][]; active: boolean; t_hit: TSnap; t_shield: TSnap;
    beams: number[][][]; current_weapon_name: string; note?: string;
  }>;
  plasma_laser: Array<{
    vx: number; vy: number; n_pts: number; trail_last: number[] | null; enemy: TSnap;
    beams: number[][][]; plasma_rings: number[][]; carve_circles: number[][];
    explosions: Array<[number, number, number, boolean, boolean]>; current_weapon_name: string;
  }>;
  first_enemy: Array<{ tanks: Array<[string, boolean]>; owner: string; result: string | null }>;
};

const vec = JSON.parse(readFileSync(VECTORS, "utf-8")) as V;

// ===========================================================================
// Tests
// ===========================================================================
describe("weapon_behaviors: oracle/mock invariants", () => {
  it("module tag matches the dumper", () => {
    expect(vec.module).toBe("weapon_behaviors");
  });
  it("vector battery is non-trivial", () => {
    const n =
      vec.eff_radius.length + vec.detonate.length + vec.funky.length +
      vec.napalm.length + vec.pool_depth.length + vec.roller.length +
      vec.digger.length + vec.sandhog.length + vec.laser.length;
    expect(n).toBeGreaterThan(300);
  });
});

describe("weapon_behaviors: module constants", () => {
  for (const c of vec.consts) {
    it("LASER_BLEED / RIOT_WEDGE_HALF", () => {
      expect(wb.LASER_BLEED).toBe(c.LASER_BLEED);
      expect(wb.RIOT_WEDGE_HALF["Riot Charge"]).toBe(c.RIOT_WEDGE_HALF_charge);
      expect(wb.RIOT_WEDGE_HALF["Riot Blast"]).toBe(c.RIOT_WEDGE_HALF_blast);
    });
  }
});

describe("weapon_behaviors: eff_radius (abs(blast) * explosion_scale)", () => {
  it(`${vec.eff_radius.length} (item, scale) radii match exactly`, () => {
    for (let i = 0; i < vec.eff_radius.length; i++) {
      const c = vec.eff_radius[i];
      const st = new MockState({ explosion_scale: c.scale });
      // exact: abs(blast)*scale over {1.0,1.5,2.0} is exactly representable.
      expect(wb.eff_radius(st, ITEMS[c.idx]), `eff_radius ${c.name} @${c.scale}`).toBe(damage.pyRound(Math.abs(ITEMS[c.idx].blast) * ([0, 1, 2, 3, 4, 6, 7, 12, 13, 14, 17, 18].includes(c.idx) ? c.scale : 1)));
    }
  });
});

// DOS replacement: combat_effects.test.ts.
// DOS replacement: combat_effects.test.ts.
describe("weapon_behaviors: _pool_depth (min rise / r, clamped 0..1)", () => {
  const surfFor = (terr: string): Surface => {
    switch (terr) {
      case "flat": return surfFlat(300);
      case "basin6": return surfBasin(180, 400, 200, 6);
      case "basin10": return surfBasin(180, 360, 250, 10);
      case "valley": return surfValley(180, 360, 300, 20);
      case "slope": return surfSlope(280, 1);
      case "onewall": return (x: number) => (x < 180 ? 250 : 360);
      case "shallow3": return surfBasin(180, 360, 357, 4);
      case "shallow7": return surfBasin(180, 360, 353, 4);
      default: throw new Error("unknown pool terr " + terr);
    }
  };
  it(`${vec.pool_depth.length} pool-depth probes match exactly`, () => {
    for (let i = 0; i < vec.pool_depth.length; i++) {
      const c = vec.pool_depth[i];
      const terr = new MockTerrain(360, 480, surfFor(c.terr));
      const st = new MockState({ terrain: terr });
      // _pool_depth is integer-grid only (column_top + min/max + integer /); exact.
      expect(
        wb._pool_depth(st, c.x, 300, c.r),
        `pool_depth ${c.terr} x=${c.x} r=${c.r} #${i}`
      ).toBe(c.out);
    }
  });
});

describe("weapon_behaviors: _nearest_tank (first-wins tie, dead skip, empty)", () => {
  const NT: Array<[string, number, number, boolean]> = [
    ["a", 100, 100, true], ["b", 110, 100, true], ["c", 100, 110, true],
    ["d", 90, 100, false], ["e", 103, 104, true],
  ];
  for (let i = 0; i < vec.nearest_tank.length; i++) {
    const c = vec.nearest_tank[i];
    // The empty-list case is the last record (qx=qy=0, no tanks); all others
    // use the fixed NT roster. Mirrors the dumper.
    const isEmpty = i === vec.nearest_tank.length - 1;
    it(`#${i} q=(${c.qx},${c.qy}) -> ${c.best}`, () => {
      const tanks = isEmpty ? [] : NT.map(([n, x, y, al]) => mkTank(n, { x, y, alive: al }));
      const st = new MockState({ tanks });
      const best = wb._nearest_tank(st, c.qx, c.qy);
      expect((best as MockTank | null)?.id ?? null, `nearest #${i}`).toBe(c.best);
    });
  }
});

// DOS replacement: combat_effects.test.ts.
// DOS replacement: combat_effects.test.ts.
// DOS replacement: combat_effects.test.ts.
// DOS replacement: combat_effects.test.ts.
describe("weapon_behaviors: popcorn / dirt tower (reconstructed binary-only)", () => {
  for (let i = 0; i < vec.popcorn.length; i++) {
    const c = vec.popcorn[i];
    it(`popcorn #${i} seed=${c.seed} scale=${c.scale}`, () => {
      const w = new Item(99, "Popcorn Bomb", 0, 1, 0, "special", {
        blast: 30, behavior: "popcorn", params: { pops: 8 },
      });
      const terr = new MockTerrain(360, 480, surfFlat(300));
      const enemy = mkTank("e", { x: 150, y: 300, team_id: 2, player_index: 0 });
      const shooter = mkTank("s", { x: 100, y: 300, team_id: 1, player_index: 5 });
      const st = new MockState({
        terrain: terr, tanks: [enemy], explosion_scale: c.scale, rng: new Rng(c.seed),
        current_shooter: shooter,
      });
      const proj = new MockProj(w, { owner: shooter, px: 150.0, py: 300.0 });
      wb.detonate(st, proj, 150, 300);
      expectTSnap(tsnap(enemy), c.enemy, `popcorn #${i} enemy`);
      expect(st.explosions, `popcorn #${i} explosions`).toEqual(c.explosions);
      expect(terr.carve_circles, `popcorn #${i} carves`).toEqual(c.carve_circles);
    });
  }
  for (let i = 0; i < vec.dirt_tower.length; i++) {
    const c = vec.dirt_tower[i];
    it(`dirt_tower #${i} scale=${c.scale}`, () => {
      const w = new Item(98, "Dirt Tower", 0, 1, 0, "dirt", { blast: 30, behavior: "dirt_tower" });
      const terr = new MockTerrain(360, 480, surfFlat(300));
      const st = new MockState({ terrain: terr, explosion_scale: c.scale, rng: new Rng(7) });
      const proj = new MockProj(w, { px: 150.0, py: 300.0 });
      wb.detonate(st, proj, 150, 300);
      expectTerrain(terr, c.terrain, `dirt_tower #${i}`);
    });
  }
});

describe("weapon_behaviors: _single_warhead (copy.copy + override)", () => {
  for (let i = 0; i < vec.single_warhead.length; i++) {
    const c = vec.single_warhead[i];
    it(`#${i} idx=${c.idx}`, () => {
      const parent = ITEMS[c.idx];
      const child = wb._single_warhead(parent);
      expect(child.idx, `${i} child_idx`).toBe(c.child_idx);
      expect(child.name, `${i} child_name`).toBe(c.child_name);
      expect(child.blast, `${i} child_blast`).toBe(c.child_blast);
      expect(child.behavior, `${i} child_behavior`).toBe(parent.behavior === "mirv" ? "mirv" : c.child_behavior);
      expect(child.warheads, `${i} child_warheads`).toBe(c.child_warheads);
      expect(child.fan, `${i} child_fan`).toBe(c.child_fan);
      // parent untouched (copy semantics)
      expect(parent.behavior, `${i} parent_behavior`).toBe(c.parent_behavior);
      expect(parent.warheads, `${i} parent_warheads`).toBe(c.parent_warheads);
    });
  }
});

describe("weapon_behaviors: on_apogee MIRV split (deterministic fan)", () => {
  for (let i = 0; i < vec.mirv.length; i++) {
    const c = vec.mirv[i];
    const label = `#${i} ${c.name} v=(${c.pvx},${c.pvy})`;
    it(label, () => {
      // Drive over the matching weapon: idx 0/6 with name suffixes for the
      // no-op cases; the dumper used base ITEMS for these, so map by idx.
      const baseIdx = c.idx;
      const owner = mkTank("o", { x: 100, y: 300, team_id: 1, player_index: 5 });
      const st = new MockState({ tanks: [owner], current_shooter: owner });
      const proj = new MockProj(ITEMS[baseIdx], { owner, px: 250.0, py: 40.0, vx: c.pvx, vy: c.pvy });
      // the "already split" no-op case sets split_done before the call
      if (c.name.endsWith("_done")) proj.split_done = true;
      wb.on_apogee(st, proj);
      expect(proj.active, `${label} active`).toBe(true);
      expect(proj.split_done, `${label} split_done`).toBe(c.proj_split_done);
      expect(st.projectiles.length, `${label} n_children`).toBe(c.n_children);
      for (let j = 0; j < c.children.length; j++) {
        const ch = st.projectiles[j];
        const w = c.children[j];
        expect(ch.weapon.behavior, `${label} child${j} behavior`).toBe("mirv");
        expect(ch.weapon.warheads, `${label} child${j} warheads`).toBe(w[1]);
        expect(ch.weapon.blast, `${label} child${j} blast`).toBe(w[2]);
        expect(ch.px, `${label} child${j} px`).toBe(w[3]);
        expect(ch.py, `${label} child${j} py`).toBe(w[4]);
        expect(ch.vx, `${label} child${j} vx`).toBe(w[5]);
        expect(ch.vy, `${label} child${j} vy`).toBe(w[6]);
        expect(ch.warheads_left, `${label} child${j} warheads_left`).toBe(w[7]);
        expect(ch.split_done, `${label} child${j} split_done`).toBe(w[8]);
        expect((ch.owner as MockTank | null)?.id ?? null, `${label} child${j} owner`).toBe(w[9]);
      }
    });
  }
});

// Roller motion now follows 3fbd:027b; covered in combat_effects.test.ts.
