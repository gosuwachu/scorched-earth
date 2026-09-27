/**
 * Per-weapon detonation and special flight behaviors -- a faithful TypeScript
 * port of scorch-py/scorch/weapon_behaviors.py (the fidelity oracle, itself
 * derived from 1.5/SCORCH.EXE). Funky Bomb and Sandhogs supersede that
 * oracle with directly recovered DOS handlers in weapon_effects.ts.
 *
 * Dispatch mirrors the weapon table at 5f38:1200 (per-type handler at +0x00,
 * behavior-class branch in FUN_2a4a_1349).  Effects follow MECHANICS "Weapon
 * behaviors" and catalog 11/12. The direct DOS reconstruction in
 * combat_effects.ts supersedes the old plasma, dirt, blast and fluid guesses. FUN_<seg>_<off> / DAT_ comments preserve the source addresses;
 * the directly recovered handlers supersede the old Python interpretations.
 *
 * ============================================================================
 * NUMERIC NOTES (load-bearing for the differential gate, test/weapon_behaviors.test.ts):
 *
 *  - Python `int(x)` truncates TOWARD ZERO -> Math.trunc(x).  Every `int(...)`
 *    cast in the source is rendered as Math.trunc here (positions, radii, spans).
 *
 *  - Python `//` (floor division) on the non-negative integer operands this
 *    module uses (bore_half = r // 2, budget // 5, span offsets) -> Math.floor.
 *
 *  - Python `round(...)` is BANKER'S rounding (round-half-to-even). Napalm's
 *    heat amount round(coeff*(1 - d/pool_r)) uses pyRound() from ./damage,
 *    not Math.round, which
 *    rounds .5 toward +Inf and would diverge on every half-integer sample.
 *
 *  - TRANSCENDENTAL sites (asserted within a tight epsilon, see the test):
 *      * _det_dirt_wedge: math.tan(radians(35)) for the wedge spread.
 *      * fire_laser / fire_plasma_laser: math.atan2(vy,vx), cos(ang), -sin(ang)
 *        for the beam direction; the per-pixel marching x += cos, y += -sin
 *        accumulates these floats, so the visited integer pixels (int(x),int(y))
 *        depend on the transcendental stream.  V8 Math.{atan2,cos,sin} and
 *        CPython math.{atan2,cos,sin} agree to <=1 ULP for these inputs, and the
 *        int() truncation of the marched position is stable across that ULP for
 *        the angles in the battery (MEASURED 0 pixel-path mismatches); the test
 *        asserts the raw direction floats within 1e-12 AND the integer pixel
 *        paths exactly.
 *      * math.hypot(dx,dy) (in _det_napalm / _nearest_tank): the
 *        engine measures between INTEGER pixel/tank coordinates, so dx,dy are
 *        integers and Math.sqrt(dx*dx+dy*dy) reproduces CPython math.hypot
 *        bit-for-bit (the damage.ts NUMERIC NOTES result; Math.hypot is NOT used).
 * ============================================================================
 */
import * as C from "./constants";
import * as damage from "./damage";
import { pyRound } from "./damage";
import * as _pal from "./palette";
import { Projectile } from "./objects";
import { stopShieldFade } from "./shields";
import { sfx } from "./sound";
import type { Item } from "./weapons";
import { startBlast, startFluid, startSoil, plasmaRadius } from "./combat_effects";
import { startFunky, startSandhog, stepWeaponEffect, type WeaponEffect } from "./weapon_effects";

// ---------------------------------------------------------------------------
// Duck-typed structural shapes weapon_behaviors reads/mutates.  These mirror
// exactly the fields scorch/weapon_behaviors.py touches, so the differential
// dumper/test can drive the port with the same lightweight mocks the oracle
// builds.  (Kept as interfaces, not classes: the port is duck-typed like the
// Python.)
// ---------------------------------------------------------------------------

/** The blast-distance reference + life/shield/health fields a tank exposes to
 *  these behaviors (a superset of damage.Tank: also carries angle for riot aim,
 *  the laserproof shield flag fire_laser reads, and -- via damage.Tank -- the
 *  health/shield/score accumulators the blast paths mutate). */
export interface BTank extends damage.Tank {
  angle?: number; // turret aim (deg) -- riot wedge default 90
  shield_laserproof: boolean; // Super Mag: stops the laser beam (fire_laser)
}

/** The pixel-framebuffer surface the behaviors read/carve.  Read methods
 *  (column_top/is_solid/is_dirt) MUST reflect prior write() calls (the digger
 *  trail stamp + dirt tower/wedge read back cells they just wrote); the bulk
 *  ops (carve_circle/deposit_circle/carve_wedge/settle) are the terminal
 *  destructive primitives.  Extends damage.Terrain (carve_circle/is_supported/h)
 *  so a BState is a valid damage.State for the explode path. */
export interface BTerrain extends damage.Terrain {
  w: number;
  column_top(x: number): number;
  is_solid(x: number, y: number): boolean;
  is_dirt(x: number, y: number): boolean;
  write(x: number, y: number, color: number): void;
  deposit_circle(cx: number, cy: number, r: number): void;
  carve_wedge(cx: number, cy: number, r: number, half_angle_deg: number, aim_deg: number): void;
  settle(cfg: unknown, rng: unknown, x_lo?: number, x_hi?: number): void;
}

/** The seeded generator interface (scorch.rng.Rng); only pick() is used here. */
export interface BRng {
  pick(n: number): number;
}

/** The projectile-loop scratch the steppers/spawners read/mutate.  A superset
 *  of objects.Projectile's used fields. */
export interface BProjectile {
  weapon: Item;
  owner: BTank | null;
  px: number;
  py: number;
  vx: number;
  vy: number;
  sx: number;
  sy: number;
  active: boolean;
  contact?: boolean;
  split_done: boolean;
  weaponEffect?: WeaponEffect;
  warheads_left: number;
  state: { [k: string]: unknown };
  trail: unknown[];
}

/** The game-state surface the behaviors thread through.  Superset of
 *  damage.State (the behaviors call damage.explode/apply_tank_damage).  Narrows
 *  tanks/terrain to the wider BTank[]/BTerrain shapes (legal: both are subtypes
 *  of the damage.State fields they override). */
export interface BState extends damage.State {
  tanks: BTank[];
  terrain: BTerrain;
  explosion_scale: number;
  rng: BRng;
  projectiles: BProjectile[];
  add_explosion(cx: number, cy: number, radius: number, kw?: { [k: string]: unknown }): void;
  add_plasma_ring(x: number, y: number, max_r: number): void;
  add_beam(pts: Array<[number, number]>): void;
  start_digger_cycle?: () => void;
  request_terrain_settle?: (force?: boolean) => void;
}

/** Python math.hypot for INTEGER (or float) operands -- Math.sqrt of the squared
 *  sum (NOT Math.hypot; see damage.ts NUMERIC NOTES: V8/CPython hypot split by
 *  1 ULP, but the squared-sum sqrt is bit-exact on the integer grid the engine
 *  measures). */
function hypot(dx: number, dy: number): number {
  return Math.sqrt(dx * dx + dy * dy);
}

/** Python math.radians. */
function radians(deg: number): number {
  return (deg * Math.PI) / 180.0;
}

export function eff_radius(state: BState, weapon: Item): number {
  // 33a1:1061: only these dispatch families use the round scale.
  const scaled = ["explosive", "roller", "riot_sphere", "leapfrog", "mirv"].includes(weapon.behavior);
  return weapon.idx > 32 ? Math.abs(weapon.blast) * state.explosion_scale : pyRound(Math.abs(weapon.blast) * (scaled ? state.explosion_scale : 1));
}

// ---------------------------------------------------------------------------
// Detonation dispatch (called when a projectile resolves at (x, y)).
// ---------------------------------------------------------------------------
export function detonate(state: BState, proj: BProjectile, x: number, y: number): void {
  state.current_weapon = proj.weapon;
  if (fizzleUnsplit(state, proj)) return;
  if (proj.weapon.behavior !== "tracer") sfx.play(proj.weapon.category === "riot" ? "riot" : proj.weapon.category === "nuclear" ? "nuke" : "explosion", state.cfg.is_on("SOUND"), { size: eff_radius(state, proj.weapon) });
  const fn = _DETONATORS[proj.weapon.behavior] ?? _det_explosive;
  fn(state, proj, x, y);
}

/** 35d5:024a..026d: a live split callback makes any early impact a dud. */
export function fizzleUnsplit(state: BState, proj: BProjectile): boolean {
  if (proj.weapon.behavior !== "mirv" || proj.split_done) return false;
  sfx.beep(200, 40, state.cfg.is_on("SOUND"));
  proj.active = false;
  return true;
}

function _det_explosive(state: BState, proj: BProjectile, x: number, y: number): void {
  if (proj.weapon.behavior === "mirv" && !proj.split_done) return;
  const radius = proj.weapon.behavior === "leapfrog" ? [20, 25, 30][Math.max(0, proj.warheads_left - 1)] * state.explosion_scale : eff_radius(state, proj.weapon);
  startBlast(state, proj, x, y, radius);
}

function _det_funky(state: BState, proj: BProjectile, x: number, y: number): void {
  // DOS dispatch entry 5 -> 2dce:0000. Keep a live controller after the
  // impacting shell is retired by _resolve_hit / _resolve_off_field.
  const controller = new Projectile(proj.owner as never, proj.weapon, x, y, 0, 0);
  startFunky(state, controller as unknown as BProjectile, x, y);
  state.projectiles.push(controller as unknown as BProjectile);
}

export function _nearest_tank(state: BState, x: number, y: number): BTank | null {
  // Distance to the tank's stored base coordinate (t.x, t.y) -- the same
  // reference damage._tank_center uses, matching the binary's single
  // (+0x0e,+0x10) struct coord (no -4 body offset; see damage._tank_center).
  let best: BTank | null = null;
  let bd = 1e9;
  for (const t of state.tanks) {
    if (t.alive) {
      const d = hypot(t.x - x, t.y - y);
      if (d < bd) {
        best = t;
        bd = d;
      }
    }
  }
  return best;
}

export function _pool_depth(state: BState, x: number, y: number, r: number): number {
  /* How deep the flame can pool at (x, y), in [0, 1].
   *
   * RECONSTRUCTED proxy for the BLOCKED 100-slot blob solver (catalog 12 s.7,
   * FUN_36e6_000b / flow probe FUN_36e6_076c).  The decompiled flow probe reads
   * pixels left/right/below: napalm stacks UPWARD only when walls on BOTH sides
   * hold it (the `2 = stuck-between-walls` return); otherwise it drains down a
   * slope.  A basin has terrain RISING ABOVE the landing on both flanks; flat
   * open ground has no rise and drains.  Returns min(left_rise, right_rise)
   * normalised by the blast radius -- the depth the pool can stack to before it
   * overspills the lower rim.  Flat ground -> 0 (shallow splash); a deep pit ->
   * ~1 (deep pool). */
  const t = state.terrain;
  r = Math.max(1, Math.trunc(r));
  const floor_y = t.column_top(x); // the pool floor (surface under impact)

  const rise = (direction: number): number => {
    let best = 0;
    for (let step = 1; step <= r; step++) {
      const top = t.column_top(x + direction * step);
      best = Math.max(best, floor_y - top); // how far the wall rises above the floor
    }
    return best;
  };

  const left = rise(-1);
  const right = rise(1);
  const enclosed = Math.min(left, right); // a pool only holds to the LOWER rim
  return Math.max(0.0, Math.min(1.0, enclosed / r));
}

function _det_napalm(state: BState, proj: BProjectile, x: number, y: number): void {
  startFluid(state, proj, x, y, false);
}

function _dirt_settle_sfx(state: BState): void {
  // Dirt gravity-drop tone (FUN_3667_06d1.c:39,52 -> 0007 30 Hz per drop, 20 Hz
  // settle).  Fired by the dirt-moving detonators, the deliberate settle events.
  sfx.play("dirt_settle", state.cfg.is_on("SOUND"));
}

function _det_dirt_sphere(state: BState, proj: BProjectile, x: number, y: number): void {
  startSoil(state, proj, x, y, "sphere", Math.abs(proj.weapon.blast));
}

function _det_dirt_slump(state: BState, proj: BProjectile, x: number, y: number): void {
  startFluid(state, proj, x, y, true);
}

function _det_dirt_wedge(state: BState, proj: BProjectile, x: number, y: number): void {
  startSoil(state, proj, x, y, "spray", Math.trunc(state.terrain.h / 3));
}

function _det_dirt_settle(state: BState, proj: BProjectile, x: number, y: number): void {
  startSoil(state, proj, x, y, "disrupt", 0);
}

function _det_riot_sphere(state: BState, proj: BProjectile, x: number, y: number): void {
  startSoil(state, proj, x, y, "riot", eff_radius(state, proj.weapon));
}

export const RIOT_WEDGE_HALF: { [name: string]: number } = {
  // half-angle (deg), byte-exact 5f38:60fc/60fe
  "Riot Charge": 45, // RECOVERED_FP.md T1 (FUN_3f76_000d)
  "Riot Blast": 60,
};

function _det_riot_wedge(state: BState, proj: BProjectile, x: number, y: number): void {
  startSoil(state, proj, x, y, "riot", eff_radius(state, proj.weapon), RIOT_WEDGE_HALF[proj.weapon.name] ?? 45);
}

function _det_tracer(_state: BState, _proj: BProjectile, _x: number, _y: number): void {
  // no destructive capability
}

function _det_plasma(state: BState, proj: BProjectile, x: number, y: number): void {
  state.current_weapon = proj.weapon;
  startBlast(state, proj, x, y, plasmaRadius(state.explosion_scale, Number(proj.state.plasmaCharge ?? 0)), true);
}

function _det_dud(_state: BState, _proj: BProjectile, _x: number, _y: number): void {
  // diggers/sandhogs handle their own
}

// ---------------------------------------------------------------------------
// Binary-only items (catalog 01 section B): present in the EXE master item
// block, ABSENT from SCORCH.DOC.  No stats, no prose, no decompiled handler
// (the name->handler binding is linker-fixed data, catalog 12 s.14).  Behaviors
// below are RECONSTRUCTED from the name + EXE block position and FLAGGED.
// ---------------------------------------------------------------------------
function _det_popcorn(state: BState, proj: BProjectile, x: number, y: number): void {
  /* Popcorn Bomb [RECONSTRUCTED]: a small cluster of popping sub-explosions.
   *
   * Name + position (immediately before Baby Missile in the EXE block) read as a
   * cheap cluster bomblet.  Modeled as a funky-style scatter chain but smaller
   * and WITHOUT the toxic-flame budget: a fixed handful of bomblets scattered in
   * the blast box, each a baby-missile blast.  Undocumented in the manual. */
  const r = eff_radius(state, proj.weapon);
  const pops = (proj.weapon.params["pops"] as number | undefined) ?? 8;
  const bomblet_r = Math.max(4, r * 0.35);
  damage.explode(state, x, y, bomblet_r); // the kernel pop
  for (let _i = 0; _i < pops; _i++) {
    const ox = state.rng.pick(Math.trunc(2 * r) + 1) - Math.trunc(r);
    const oy = state.rng.pick(Math.trunc(r) + 1); // scatter mostly upward
    damage.explode(state, Math.trunc(x + ox), Math.trunc(y - oy), bomblet_r);
  }
}

function _det_dirt_tower(state: BState, proj: BProjectile, x: number, y: number): void {
  /* Dirt Tower [RECONSTRUCTED]: raise a tall vertical pillar of dirt.
   *
   * No weapon routine builds a vertical dirt column in the .c set (catalog 10
   * s.10, 12 s.13: BLOCKED).  Name read literally: deposit a narrow, tall dirt
   * column up from the impact.  Width ~ blast/4, height ~ blast*2.
   * Undocumented in the manual. */
  const r = Math.trunc(eff_radius(state, proj.weapon));
  const half_w = Math.max(2, Math.trunc(r / 4)); // Python r // 4 (floor; r>=0)
  const height = Math.max(r, r * 2);
  const top = Math.max(0, y - height);
  for (let xx = x - half_w; xx <= x + half_w; xx++) {
    for (let yy = top; yy <= y; yy++) {
      if (!state.terrain.is_solid(xx, yy)) {
        state.terrain.write(xx, yy, C.DIRT_SHADE_LO + 8);
      }
    }
  }
  state.terrain.settle(state.cfg, state.rng, x - half_w - 4, x + half_w + 4);
  _dirt_settle_sfx(state);
}

function _det_plasma_laser(state: BState, proj: BProjectile, x: number, y: number): void {
  /* Plasma Laser detonation fallback [RECONSTRUCTED].
   *
   * Flight is handled synchronously by fire_plasma_laser (a laser-style beam);
   * this radial form is only reached if it is ever dispatched as a ballistic
   * detonation.  Treated as a plasma burst at the impact. */
  _det_plasma(state, proj, x, y);
}

type Detonator = (state: BState, proj: BProjectile, x: number, y: number) => void;

const _DETONATORS: { [behavior: string]: Detonator } = {
  explosive: _det_explosive,
  funky: _det_funky,
  napalm: _det_napalm,
  dirt_sphere: _det_dirt_sphere,
  dirt_slump: _det_dirt_slump,
  dirt_wedge: _det_dirt_wedge,
  dirt_settle: _det_dirt_settle,
  riot_sphere: _det_riot_sphere,
  riot_wedge: _det_riot_wedge,
  tracer: _det_tracer,
  plasma: _det_plasma,
  roller: _det_explosive, // roller detonates as an explosive at its valley
  leapfrog: _det_explosive,
  mirv: _det_explosive, // each warhead is an explosive
  digger: _det_dud,
  sandhog: _det_dud,
  // binary-only, reconstructed (catalog 01 section B)
  popcorn: _det_popcorn,
  dirt_tower: _det_dirt_tower,
  plasma_laser: _det_plasma_laser,
};

// ---------------------------------------------------------------------------
// Special flight behaviors (driven per-step by the game projectile loop).
// Each returns True if the projectile is still live, False if resolved.
// ---------------------------------------------------------------------------
export function on_apogee(state: BState, proj: BProjectile): void {
  /* MIRV / Death's Head apogee split (FUN_35d5_041b).
   *
   * Byte-confirmed table at 5f38:529e {20,35,5,9,50,20}: MIRV (120e=0) ->
   * count=5, fan-step=50, child blast=20; Death's Head (120e=1) -> count=9,
   * fan-step=20, child blast=35.  The spawner loops i in [0, count); the
   * per-child X-velocity offset is the INTEGER `fan * (i - (count+1)//2)`, and a
   * child is spawned only when that offset != 0 (FUN_35d5_041b:33).  So the
   * center (zero-offset) warhead is skipped -- count=5 spawns 4 children, count=9
   * spawns 8 -- and the fan is asymmetric (more children to one side).  No
   * randomness (contrast Funky Bomb).  Children inherit the parent's apogee
   * position and Y-velocity; only X-velocity is fanned. */
  if (proj.weapon.behavior !== "mirv" || proj.split_done) {
    return;
  }
  // Cluster-split tick (FUN_35d5_041b.c:29 -> 0007 one blip; freq arg BLOCKED,
  // the port "mirv" voice is a flagged placeholder, sound.py:439).
  sfx.play("mirv", state.cfg.is_on("SOUND"));
  proj.split_done = true;
  proj.state.cluster = {};
  const n = proj.weapon.warheads;
  const fan = proj.weapon.fan;
  const center = Math.floor((n + 1) / 2); // (count+1)/2, integer (n>=0)
  for (let i = 0; i < n; i++) {
    const offset = fan * (i - center);
    if (offset === 0) {
      // zero-offset child skipped
      continue;
    }
    // The Projectile ctor reads only owner.player_index (objects.ts:107); a
    // BTank carries it, so cast across the nominal BTank/objects.Tank gap (the
    // child result is likewise cast back to BProjectile -- the loop only touches
    // the BProjectile-shaped fields it sets below).
    const child = new Projectile(
      proj.owner as unknown as ConstructorParameters<typeof Projectile>[0],
      _single_warhead(proj.weapon),
      proj.px,
      proj.py,
      proj.vx + offset,
      proj.vy
    ) as unknown as BProjectile;
    child.state.cluster = proj.state.cluster;
    child.warheads_left = 1;
    child.split_done = true;
    state.projectiles.push(child);
  }
}

export function _single_warhead(weapon: Item): Item {
  /* A split MIRV child explodes as a plain explosive of the child blast
   * (the child carries the spawn-table blast radius already on weapon.blast). */
  // copy(weapon): shallow copy of the Item, then override behavior/warheads.
  // Object.assign onto a blank-prototype Item clone reproduces copy.copy's
  // shallow-field copy (params reference is shared, as in Python's copy.copy).
  const w = Object.assign(Object.create(Object.getPrototypeOf(weapon)), weapon) as Item;
  w.behavior = weapon.behavior === "mirv" ? "mirv" : "explosive";
  w.warheads = 1;
  return w;
}

export function start_roller(state: BState, proj: BProjectile, x: number, y: number): void {
  // 3fbd:0003: momentum decides wide flat areas; scan both sides for a drop.
  let dir = proj.vx > 0 ? 1 : -1;
  const surface = Math.min(y - 1, state.terrain.column_top(x) - 1);
  const scan = (d: number) => {
    let n = 0;
    for (let xx = x + d; xx > 0 && xx < state.terrain.w - 1; xx += d) {
      if (state.terrain.is_solid(xx, surface)) return { drop: false, n };
      if (!state.terrain.is_solid(xx, surface + 1)) return { drop: true, n };
      n++;
    }
    return { drop: false, n };
  };
  const left = scan(-1), right = scan(1);
  if (!(left.n + right.n > 6 && left.n > 2 && right.n > 2) && left.drop !== right.drop) dir = left.drop ? -1 : 1;
  proj.state.rolling = true; proj.state.dir = dir;
  proj.px = proj.sx = x; proj.py = proj.sy = surface;
  proj.vx = proj.vy = 0;
}

export function step_roller(state: BState, proj: BProjectile): boolean {
  // 3fbd:027b: descend one pixel until supported, then move horizontally.
  // It cannot climb a one-pixel uphill step and does not snap down a cliff.
  let x = Math.trunc(proj.px), y = Math.trunc(proj.py);
  let dir = Number(proj.state.dir);
  if (y < state.terrain.h - 2 && !state.terrain.is_solid(x, y + 1)) y++;
  else {
    x += dir;
    if (x < 1 || x > state.terrain.w - 2) {
      const cfg = state.cfg as BState["cfg"] & { live_elastic?: number; elastic?: number };
      const wall = cfg.live_elastic ?? cfg.elastic ?? 5;
      if (wall === 0) { proj.active = false; return false; }
      if (wall === 5) return _resolve_roller(state, proj);
      if (wall === 1) x = x < 1 ? state.terrain.w - 2 : 1;
      else { dir = -dir; x = Math.trunc(proj.px); proj.state.dir = dir; }
    }
    const tank = state.tanks.some((t) => t.alive && Math.abs(t.x - x) <= t.half_width && y >= t.y - 10 && y <= t.y);
    if (state.terrain.is_solid(x, y) || tank) {
      proj.px = x; proj.py = y;
      return _resolve_roller(state, proj);
    }
  }
  proj.px = proj.sx = x; proj.py = proj.sy = y;
  return true;
}

function _resolve_roller(state: BState, proj: BProjectile): boolean {
  detonate(state, proj, Math.trunc(proj.px), Math.trunc(proj.py));
  proj.active = false;
  return false;
}

export function start_digger(state: BState, proj: BProjectile, x: number, y: number): void {
  startSandhog(state, proj, x, y, true);
}

function _stamp_digger_trail(state: BState, x: number, y: number, half: number): void {
  /* Carve the bore span and stamp a glowing trail band the digger cycles.
   *
   * The real digger path is the dispatch at FUN_2a4a_1349.c:200-219 (which arms
   * the data-bound stepper at code offset 0x99c, set into the projectile's +0x4c)
   * plus the span-clear support FUN_262c_0078.c (string s_Teleport_Shield; clears
   * the bored column via FUN_262c_0104).  The bore depth = abs(blast) = 10/20/35
   * is byte-correct.
   *
   * CITATION FIX + the 0xAF band is now RECONSTRUCTED, not sourced.  The prior
   * code cited FUN_352c_00c9.c:103-128 for the 0xAF..0xB8 glow.  That function
   * is a WINNER/fanfare render routine: 0 callers, takes a TANK-RECORD pointer,
   * programs a full DAC palette, sprays a 200-frame rising-siren particle column
   * and reaps pixels > 0xa9.  It is the ONLY corpus site that writes iVar2+0xaf
   * or arms the (*ef00/ef04)(0xaf,10) cycle -- so the 0xAF..0xB8 trail band
   * CANNOT be confirmed from the real digger path.  The actual 0x99c stepper body
   * is BLOCKED (un-decompiled), and neither FUN_2a4a_1349 nor FUN_262c_0078
   * writes a glow band.  The 0xAF glow + 200-frame cycle below is therefore a
   * RECONSTRUCTED trail effect (a plausible match to the fanfare's palette idiom),
   * NOT a byte-sourced digger property.  We clear the bore to sky, edge the channel
   * walls with the reconstructed 0xAF glow, then arm the trail cycle. */
  const t = state.terrain;
  const lo = _pal.DIGGER_BAND_LO;
  const span = _pal.DIGGER_BAND_HI - lo; // 0xAF..0xB8 -> 9 offsets max
  for (let dx = -half; dx <= half; dx++) {
    t.write(x + dx, y, C.COL_SKY); // bore the channel to sky
  }
  // edge glow: stamp the trail band on the rim cells just outside the bore and
  // one row below, where the binary's >0x69 test catches wall/debris pixels.
  {
    let k = 0;
    for (let dx = half; dx <= half + 2; dx++, k++) {
      const gi = Math.min(_pal.DIGGER_BAND_HI, lo + k);
      if (t.is_solid(x + dx, y)) {
        t.write(x + dx, y, gi);
      }
      if (t.is_solid(x - dx, y)) {
        t.write(x - dx, y, gi);
      }
    }
  }
  {
    // Python: for k, dx in enumerate(range(0, min(half + 1, span + 1)))
    const hi = Math.min(half + 1, span + 1);
    let k = 0;
    for (let dx = 0; dx < hi; dx++, k++) {
      const gi = Math.min(_pal.DIGGER_BAND_HI, lo + k);
      if (t.is_solid(x + dx, y + 1)) {
        t.write(x + dx, y + 1, gi);
      }
      if (t.is_solid(x - dx, y + 1)) {
        t.write(x - dx, y + 1, gi);
      }
    }
  }
  if (state.start_digger_cycle !== undefined) {
    state.start_digger_cycle();
  }
}

export function step_digger(state: BState, proj: BProjectile): boolean {
  const t = state.terrain;
  const x = Math.trunc(proj.px);
  const y = Math.trunc(proj.py);
  // clear a span at this depth + stamp/arm the 0xAF trail glow cycle.  The bore
  // half-width is tier-scaled (start_digger; was a fixed 3 that removed too little).
  _stamp_digger_trail(state, x, y, (proj.state["bore_half"] as number | undefined) ?? 3);
  proj.state["depth"] = (proj.state["depth"] as number) + 1;
  proj.py += 1;
  proj.sx = Math.trunc(proj.px);
  proj.sy = Math.trunc(proj.py);
  if ((proj.state["depth"] as number) >= (proj.state["max_depth"] as number) || proj.py >= t.h - 2) {
    proj.active = false; // fizzles, no damage
    return false;
  }
  return true;
}

export function start_sandhog(state: BState, proj: BProjectile, x: number, y: number): void {
  startSandhog(state, proj, x, y);
}

export function step_sandhog(state: BState, proj: BProjectile): boolean {
  stepWeaponEffect(state, proj);
  return proj.active;
}

export const LASER_BLEED = 0x28; // FUN_3319_01fe:96 energy bleed per beam pixel (40)

export function fire_laser(state: BState, proj: BProjectile): void {
  // 3319:01fe: 40 energy/pixel, another 40 when cutting dirt. A tank
  // stops the beam: energy/5 is discharged in <=10 HP pulses, subtracting
  // 50 from the pulse budget each time. Super Mag recharges by energy/100.
  state.current_weapon = proj.weapon;
  sfx.play("laser", state.cfg.is_on("SOUND"));
  let energy = (proj.state["energy"] as number | undefined) ?? 50;
  const ang = Math.atan2(proj.vy, proj.vx);
  const dx = Math.cos(ang);
  const dy = -Math.sin(ang);
  let x = proj.px;
  let y = proj.py;
  const pts: Array<[number, number]> = [];
  const hit = new Set<BTank>();
  while (energy >= 1 && 0 <= x && x < state.terrain.w && 0 <= y && y < state.terrain.h) {
    const ix = Math.trunc(x);
    const iy = Math.trunc(y);
    pts.push([ix, iy]);
    if (state.terrain.is_dirt(ix, iy)) {
      state.terrain.carve_circle(ix, iy, 3);
      energy -= LASER_BLEED;
    }
    for (const tk of state.tanks) {
      if (
        tk.alive &&
        !hit.has(tk) &&
        Math.abs(tk.x - ix) <= tk.half_width &&
        Math.abs(tk.y - 4 - iy) <= 6
      ) {
        if (tk.shield_laserproof && tk.shield_hp > 0) {
          stopShieldFade(state, tk);
          tk.shield_hp = Math.min(200, tk.shield_hp + Math.trunc(energy / 100));
          energy = 0; // Super Mag stops and absorbs the beam
          break;
        }
        for (let remaining = Math.trunc(energy / 5); remaining > 0; remaining -= 50)
          damage.apply_tank_damage(state, tk, Math.min(10, remaining));
        hit.add(tk);
        energy = 0;
        break;
      }
    }
    x += dx;
    y += dy;
    const cfg = state.cfg as BState["cfg"] & { live_elastic?: number; elastic?: number };
    if ((cfg.live_elastic ?? cfg.elastic) === 1) {
      if (x < 1) x += state.terrain.w - 2;
      else if (x >= state.terrain.w - 1) x -= state.terrain.w - 2;
    }
    energy -= LASER_BLEED; // bleed 0x28 per pixel
  }
  proj.trail = pts;
  state.add_beam(pts);
  proj.active = false;
}

export function fire_plasma_laser(state: BState, proj: BProjectile): void {
  /* Plasma Laser [RECONSTRUCTED]: a battery-powered beam that bursts into a
   * plasma sweep at its terminal point.
   *
   * Binary-only, undocumented (catalog 01 section B).  Name = Laser + Plasma:
   * modeled as the laser beam (cuts dirt + damages everything per pixel, energy
   * = field*10) followed by a battery-scaled plasma burst where the beam
   * terminates.  Reuses fire_laser for the beam, then a plasma blast at the last
   * beam pixel.  FLAGGED reconstructed. */
  fire_laser(state, proj);
  let ex: number;
  let ey: number;
  if (proj.trail.length > 0) {
    const last = proj.trail[proj.trail.length - 1] as [number, number];
    ex = last[0];
    ey = last[1];
  } else {
    ex = Math.trunc(proj.px);
    ey = Math.trunc(proj.py);
  }
  _det_plasma(state, proj, ex, ey);
}
