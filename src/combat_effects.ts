/** Staged DOS 1.5 combat handlers. Addresses refer to the original MZ image;
 * see oracle/COMBAT_FIDELITY.md. Simulation owns every pixel and RNG draw. */
import * as C from "./constants";
import * as damage from "./damage";
import { sfx } from "./sound";
import { Projectile } from "./objects";
import type { BProjectile, BRng, BState } from "./weapon_behaviors";

type Point = [number, number];
export interface BlastEffect {
  kind: "blast";
  x: number; y: number; radius: number; grown: number;
  phase: "grow" | "hold" | "erase"; clock: number; cycle: number;
  plasma: boolean; textured: boolean; pixels: Uint8Array; mask: Uint8Array;
  group?: object;
  hop?: { vx: number; vy: number; left: number };
}
export interface SoilEffect {
  kind: "soil";
  mode: "sphere" | "spray" | "riot" | "disrupt";
  x: number; y: number; radius: number; grown: number; clock: number;
  aim: number; half: number; flash?: number;
}
export interface FluidEffect {
  kind: "fluid";
  dirt: boolean; hot: boolean; phase: "flow" | "ignite" | "burn" | "cleanup";
  frontier: Point[]; points: Point[]; occupied: Set<number>;
  samples: Point[]; limit: number; clock: number;
  flames: Array<{ x: number; y: number; r: number; color: number }>;
  emitter: number; row: number; height: number; flameX: number; cycle: number;
  death?: boolean;
  dirtColors?: number[];
  flowCycle: [number, number]; flowColor: [number, number, number];
}
export type CombatEffect = BlastEffect | SoilEffect | FluidEffect;

/** 3869:0081/0266/03c1: midpoint displacement, including the zero sentinel,
 * edge-length perturbation and TL, TR, BR, BL recursion order. */
export function blastTexture(width: number, height: number, rng: BRng): Uint8Array {
  const pixels = new Uint8Array(width * height);
  const at = (x: number, y: number) => y * width + x;
  for (const [x, y] of [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]]) pixels[at(x, y)] = rng.pick(40);
  const midpoint = (ax: number, ay: number, bx: number, by: number) => {
    const p = at((ax + bx) >> 1, (ay + by) >> 1);
    if (pixels[p]) return;
    const span = Math.abs(ax - bx) + Math.abs(ay - by);
    pixels[p] = Math.max(0, Math.min(39, rng.pick(2 * span) - span + ((pixels[at(ax, ay)] + pixels[at(bx, by)] + 1) >> 1)));
  };
  const divide = (x0: number, y0: number, x1: number, y1: number): void => {
    if (x1 - x0 < 2 && y1 - y0 < 2) return;
    const x = (x0 + x1) >> 1, y = (y0 + y1) >> 1;
    midpoint(x0, y0, x1, y0); midpoint(x1, y0, x1, y1);
    midpoint(x1, y1, x0, y1); midpoint(x0, y1, x0, y0);
    pixels[at(x, y)] = (pixels[at(x0, y0)] + pixels[at(x1, y0)] + pixels[at(x1, y1)] + pixels[at(x0, y1)] + 2) >> 2;
    divide(x0, y0, x, y); divide(x, y0, x1, y);
    divide(x, y, x1, y1); divide(x0, y, x, y1);
  };
  divide(0, 0, width - 1, height - 1);
  return pixels;
}

export function plasmaRadius(scale: number, batteries: number): number {
  const lo = damage.pyRound(20 * scale), hi = damage.pyRound(75 * scale);
  return lo + Math.trunc((hi - lo) * Math.max(0, Math.min(10, batteries)) / 10);
}

function controller(state: BState, shot: BProjectile, effect: CombatEffect): BProjectile {
  const p = new Projectile(shot.owner as never, shot.weapon, shot.px, shot.py, 0, 0) as unknown as BProjectile;
  p.contact = shot.contact ?? false;
  p.weaponEffect = effect;
  state.projectiles.push(p);
  return p;
}

/** Standard blasts and Plasma share the texture, but not the damage/mask. */
export function startBlast(state: BState, shot: BProjectile, x: number, y: number, radius: number, plasma = false): void {
  radius = Math.max(1, damage.pyRound(radius));
  const size = 2 * radius + 1;
  const textured = plasma || (!shot.state.cluster && radius >= damage.pyRound(40 * state.explosion_scale));
  const pixels = textured ? blastTexture(size, size, state.rng) : new Uint8Array(size * size);
  const mask = new Uint8Array(size * size);
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    if (dx * dx + dy * dy > radius * radius) continue;
    const xx = x + dx, yy = y + dy, i = (dy + radius) * size + dx + radius;
    if (plasma && (state.terrain.is_dirt(xx, yy) || (shot.owner &&
        Math.abs(xx - shot.owner.x) <= shot.owner.half_width && yy >= shot.owner.y - 10 && yy <= shot.owner.y))) continue;
    mask[i] = 1;
    if (!textured) pixels[i] = Math.max(0, 21 - Math.trunc(Math.sqrt(dx * dx + dy * dy) * 20 / radius));
  }
  controller(state, shot, { kind: "blast", x, y, radius, grown: 0, phase: "grow", clock: 0, cycle: 0,
    plasma, textured, pixels, mask, group: shot.state.cluster as object | undefined,
    hop: shot.weapon.behavior === "leapfrog" && shot.warheads_left > 1 ? {
      vx: Number(shot.state.launchVx ?? shot.vx) / 1.5,
      vy: Number(shot.state.launchVy ?? -Math.abs(shot.vy)) / 1.5, left: shot.warheads_left - 1,
    } : undefined });
}

function stepBlast(state: BState, shot: BProjectile, e: BlastEffect): void {
  e.cycle++;
  if (e.phase === "grow") {
    e.grown = Math.min(e.radius, e.grown + (e.radius < 40 ? 1 : 2));
    if (e.grown === e.radius) { e.phase = "hold"; e.clock = 0; }
    return;
  }
  if (e.phase === "hold") {
    // 35d5:0009: all cluster warheads remain painted until the volley lands.
    if (e.group && state.projectiles.some((p) => p.active && !p.weaponEffect && p.state.cluster === e.group)) return;
    const hold = e.group ? 49 : e.plasma ? 129 : e.textured ? 99 : e.radius > 30 ? 49 : 0;
    if (++e.clock < hold) return;
    if (!e.plasma) state.terrain.carve_circle(e.x, e.y, e.radius);
    e.phase = "erase"; e.clock = 0;
    return;
  }
  const cleanup = e.plasma ? 42 : e.textured ? 10 : 25;
  if (++e.clock < cleanup) return;
  for (const t of state.tanks) {
    if (!t.alive || (e.plasma && t === shot.owner)) continue;
    const d = Math.sqrt((t.x - e.x) ** 2 + (t.y - e.y) ** 2);
    if (d >= e.radius) continue;
    const falloff = damage.pyRound((e.radius - d) * 100 / e.radius);
    const amount = e.plasma ? falloff + 80 : falloff * (shot.weapon.idx + 1);
    damage.apply_tank_damage(state, t, amount > 100 ? 110 : amount);
  }
  shot.active = false;
  if (e.hop) {
    const next = new Projectile(shot.owner as never, shot.weapon, e.x, e.y - 1, e.hop.vx, e.hop.vy);
    next.contact = shot.contact ?? false;
    next.warheads_left = e.hop.left;
    next.state.launchVx = e.hop.vx; next.state.launchVy = e.hop.vy;
    state.projectiles.push(next as unknown as BProjectile);
  }
}

export function startSoil(state: BState, shot: BProjectile, x: number, y: number, mode: SoilEffect["mode"], radius: number, half = 180): void {
  controller(state, shot, { kind: "soil", mode, x, y, radius: Math.trunc(radius), grown: 0, clock: 0,
    aim: shot.owner?.angle ?? 90, half });
}

function stepSoil(state: BState, shot: BProjectile, e: SoilEffect): void {
  e.clock++;
  if (e.mode === "disrupt") {
    e.flash = state.rng.pick(101) / 100;
    sfx.beep(1000 + state.rng.pick(100) * 100, 10, state.cfg.is_on("SOUND"));
    if (e.clock < 100) return;
    // 262c:013e bypasses the SUSPEND_DIRT gate.
    if (state.request_terrain_settle) state.request_terrain_settle(true);
    else state.terrain.settle(Object.assign(Object.create(state.cfg), { SUSPEND_DIRT: 0 }), state.rng);
    shot.active = false;
    return;
  }
  if (e.mode === "spray") {
    for (let row = 0; row < 2 && e.grown < e.radius; row++, e.grown++) {
      const y = e.y - e.grown, spread = 1 + e.grown;
      if (y < 2) { e.grown = e.radius; break; }
      let left = Math.max(1, e.x - spread), right = Math.min(state.terrain.w - 2, e.x + spread);
      for (let x = e.x; x >= left; x--) if (state.terrain.is_dirt(x, y)) { left = x + 1; break; }
      for (let x = e.x; x <= right; x++) if (state.terrain.is_dirt(x, y)) { right = x - 1; break; }
      for (let i = 0; i < Math.trunc((right - left + 1) / 3); i++) {
        state.terrain.write(left + state.rng.pick(right - left + 1), y, C.DIRT_SHADE_LO);
      }
    }
  } else if (e.grown < e.radius - 1) {
    e.grown++;
    if (e.mode === "sphere") {
      state.terrain.deposit_circle(e.x, e.y, e.grown);
      sfx.beep((e.grown % 5 + 1) * 100, 10, state.cfg.is_on("SOUND"));
    }
    else state.terrain.carve_wedge(e.x, e.y, e.grown, e.half, e.aim);
    return;
  }
  if (e.mode === "riot" && e.clock < 2 * e.radius) return;
  if (e.mode !== "spray" || e.grown >= e.radius) shot.active = false;
}

export function startFluid(state: BState, shot: BProjectile, x: number, y: number, dirt: boolean): void {
  // 36e6:01a0 starts at the last clear flight pixel, never inside solid dirt.
  const prev = shot as BProjectile & { prev_px?: number; prev_py?: number };
  if (prev.prev_px !== undefined && prev.prev_py !== undefined) {
    const dx = prev.prev_px - x, dy = prev.prev_py - y;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
    for (let i = 1; i <= steps; i++) {
      const xx = Math.trunc(x + dx * i / steps), yy = Math.trunc(y + dy * i / steps);
      if (!state.terrain.is_solid(xx, yy)) { x = xx; y = yy; break; }
    }
  }
  while (y > 2 && state.terrain.is_solid(x, y)) y--;
  const effect: FluidEffect = { kind: "fluid", dirt, hot: shot.weapon.idx === 9, phase: "flow",
    frontier: [[x, y]], points: [[x, y]], occupied: new Set([y * state.terrain.w + x]), samples: [[x, y]],
    limit: dirt || shot.weapon.idx === 9 ? 20 : 15, clock: 0, flames: [],
    emitter: 0, row: 0, height: 0, flameX: x, cycle: 0, flowCycle: [0, 0], flowColor: [240, 80, 80] };
  if (dirt) {
    // 323a:0bcb/0c20 chooses from the active terrain shades 88..103 (or 80
    // for unshaded dirt). The browser terrain owns pixels rather than a DOS
    // color bitmask, so derive the same ascending table from its used shades.
    const grid = (state.terrain as BState["terrain"] & { grid?: Uint8Array }).grid;
    effect.dirtColors = grid ? [...new Set(grid)].filter((c) => c >= 88 && c < 104).sort((a, b) => a - b) : [];
    if (!effect.dirtColors.length) effect.dirtColors = [80];
    state.terrain.write(x, y, effect.dirtColors[state.rng.pick(effect.dirtColors.length)]);
  }
  controller(state, shot, effect);
}

/** 2d4f:0258: six tall flame plumes, not ballistic fireworks. */
export function startDeathFlames(state: BState, shot: BProjectile, x: number, y: number): void {
  const e: FluidEffect = { kind: "fluid", dirt: false, hot: false, phase: "ignite", frontier: [], points: [],
    occupied: new Set(), samples: Array.from({ length: 6 }, () => [x, y]), limit: 0, clock: 0, flames: [],
    emitter: 0, row: 0, height: 0, flameX: x, cycle: 0, death: true, flowCycle: [0, 0], flowColor: [240, 80, 80] };
  controller(state, shot, e);
}

function stepFluid(state: BState, shot: BProjectile, e: FluidEffect): void {
  if (e.phase === "cleanup") { shot.active = false; return; }
  if (e.phase === "burn") {
    sfx.beep(state.rng.pick(50), 8, state.cfg.is_on("SOUND"));
    e.cycle++;
    if (++e.clock >= 50) e.phase = "cleanup";
    return;
  }
  if (e.phase === "ignite") { growFlame(state, e); return; }
  const w = state.terrain.w, h = state.terrain.h;
  const cfg = state.cfg as BState["cfg"] & { wind?: number; live_elastic?: number; elastic?: number };
  const wrap = (cfg.live_elastic ?? cfg.elastic) === 5;
  const sideX = (x: number) => wrap ? (x < 1 ? w - 2 : x > w - 2 ? 1 : x) : x;
  const free = (x: number, y: number) => x > 0 && x < w - 1 && y > 1 && y < h - 1 &&
    !state.terrain.is_solid(x, y) && !e.occupied.has(y * w + x);
  const nextPoint = (x: number, y: number): Point | undefined => {
    const side = (cfg.wind ?? 0) > 0 ? 1 : -1;
    return ([[x, y + 1], [sideX(x + side), y], [sideX(x - side), y], [x, y - 1]] as Point[])
      .find(([xx, yy]) => free(xx, yy));
  };
  let full = false;
  for (let step = 0; step < 8 && e.frontier.length && e.samples.length < e.limit && e.clock++ < 1000; step++) {
    e.frontier.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const parent = e.frontier[0], [x, y] = parent;
    const next = nextPoint(x, y);
    if (next) {
      // 36e6:03ac..0407 deposits before attempting allocation. The 100 slots
      // bound the live queue, not the number of pixels ever deposited.
      full = e.frontier.length === 100;
      if (!full) e.frontier.push(next);
      e.points.push(next); e.occupied.add(next[1] * w + next[0]);
      if (e.dirt) state.terrain.write(next[0], next[1], e.dirtColors![state.rng.pick(e.dirtColors!.length)]);
      if ((e.points.length - 1) % 20 === 0) e.samples.push(next);
    }
    // 36e6:013e/0437 cycles the flowing fuel palette on odd deposits,
    // consuming two draws even when sound is disabled.
    if (!e.dirt && (e.points.length - 1) % 2 === 1) {
      e.flowCycle[0] = (e.flowCycle[0] + 2 + state.rng.pick(18)) % 40;
      e.flowCycle[1] = (e.flowCycle[1] + 2 + state.rng.pick(8)) % 10;
      e.flowColor = [252, 4 * (10 + e.flowCycle[0]), 4 * (10 + e.flowCycle[1])];
    }
    // 36e6:0448..04c2 retires the OLD parent immediately, even if the new
    // pixel sorts ahead of it. Delaying this check strands reusable slots.
    if (!nextPoint(x, y)) e.frontier.splice(e.frontier.indexOf(parent), 1);
    if (full) break;
  }
  if (!full && e.frontier.length && e.samples.length < e.limit && e.clock < 1000) return;
  if (e.dirt) { shot.active = false; return; }
  e.phase = "ignite"; e.clock = 0;
}

/** 2d4f:014e / 36e6:04eb: finish each emitter before damaging nearby tanks.
 * One row per 60 Hz simulation tick is the browser's visible timing adapter. */
function growFlame(state: BState, e: FluidEffect): void {
  const [sx, sy] = e.samples[e.emitter];
  if (e.height === 0) {
    e.flameX = sx + (e.death ? state.rng.pick(11) - 5 : 0);
    e.height = (e.death ? 10 : 5) + state.rng.pick(10);
  }
  const x = e.flameX, y = sy - 2 * e.row;
  for (let band = 0; band < 3 && e.height - e.row > band * 2; band++) {
    const r = (e.height - e.row - band * 2) >> 1;
    e.flames.push({ x, y, r, color: 199 - band * 10 });
    if (!e.death) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r && state.terrain.is_dirt(x + dx, y + dy))
          state.terrain.write(x + dx, y + dy, 81 + state.rng.pick(5));
      }
    }
    sfx.beep(state.rng.pick(50), 8, state.cfg.is_on("SOUND"));
  }
  e.flameX += state.rng.pick(5) - 2;
  if (++e.row < e.height) return;
  e.cycle++;
  if (!e.death) sfx.beep(state.rng.pick(50), 8, state.cfg.is_on("SOUND"));
  // Each sample is a heat source, not a generic circular explosion.
  if (!e.death) for (const t of state.tanks) {
    const d = Math.sqrt((t.x - sx) ** 2 + (t.y - sy) ** 2);
    if (d < (e.hot ? 40 : 25)) damage.apply_tank_damage(state, t, damage.pyRound((e.hot ? 50 : 30) - d));
  }
  e.row = 0; e.height = 0;
  if (++e.emitter === e.samples.length) { e.phase = "burn"; e.clock = 0; }
}

/** 2d4f:00cc: three ten-entry VGA ramps, rotated during the fifty burn ticks. */
export function flameColor(index: number, cycle = 0): [number, number, number] {
  const n = ((index - 170 + cycle) % 30 + 30) % 30, i = n % 10, band = Math.floor(n / 10);
  return [(43 + 2 * i) * 4, (band === 0 ? 10 + i : band === 1 ? 10 + 2 * i : 43 + 2 * i) * 4, (10 + i) * 4];
}

export function stepCombatEffect(state: BState, shot: BProjectile, e: CombatEffect): void {
  if (e.kind === "blast") stepBlast(state, shot, e);
  else if (e.kind === "soil") stepSoil(state, shot, e);
  else stepFluid(state, shot, e);
}

/** Palette 200..239 red triangular ramp, rotated without changing geometry. */
export function blastPixel(e: BlastEffect, dx: number, dy: number): [number, number, number] | null {
  if (dx * dx + dy * dy > e.grown * e.grown) return null;
  const i = (dy + e.radius) * (2 * e.radius + 1) + dx + e.radius;
  if (!e.mask[i]) return null;
  const index = e.pixels[i];
  if (e.phase === "erase") {
    if (e.plasma && index <= e.clock) return [36, 36, 124];
    if (!e.plasma && index < e.clock * (e.textured ? 4 : 1)) return null;
  }
  const band = (index + e.cycle) % 40;
  return [Math.trunc((band < 20 ? band : 39 - band) * 252 / 19), 0, 0];
}
