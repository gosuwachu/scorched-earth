/** DOS 1.5 effects recovered from the actual dispatch table, not the Python
 * approximations. See oracle/WEAPON_FIDELITY.md for addresses and limitations. */
import { startBlast, stepCombatEffect, type CombatEffect } from "./combat_effects";
import { stepDeathEffect, type DeathEffect } from "./death_effects";
import * as C from "./constants";
import * as damage from "./damage";
import { pyRound } from "./damage";
import type { BProjectile, BState } from "./weapon_behaviors";

export type Point = [number, number];
export interface FunkyBurst {
  x: number;
  y: number;
  radius: number;
  grown: number;
  color: number;
}
interface Arc {
  ax: number; ay: number; bx: number; by: number;
  ox: number; oy: number; shift: number; left: number;
  lastX: number; lastY: number;
}
export interface FunkyEffect {
  kind: "funky";
  age: number;
  x: number; y: number;
  targets: number[];
  index: number;
  phase: "grow" | "arc" | "hold";
  hold: number;
  arc: Arc | null;
  trails: Point[][];
  bursts: FunkyBurst[];
}
export interface Tunnel {
  x: number; y: number;
  next: Point | null;
  direction: number;
  straight: number;
}
export interface SandhogEffect {
  kind: "sandhog";
  digger?: boolean;
  tunnels: Tunnel[];
  remaining: number;
  branchClock: number;
  spawned: number;
  // Short-lived charge stipple, separate from the terrain collision plane.
  charges: Array<{ x: number; y: number; radius: number; age: number; pixels: Point[] }>;
}
export type WeaponEffect = FunkyEffect | SandhogEffect | CombatEffect | DeathEffect;

// DS:0ad6 and DS:0af6, in original direction order (N, NE, E, ...).
export const TUNNEL_DIRECTIONS: readonly Point[] = [
  [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
];
const TUNNEL_SIDES: readonly Point[] = [
  [1, 0], [-1, -1], [0, 1], [1, -1], [1, 0], [1, 1], [0, -1], [1, -1],
];
// DS:1f62, VGA DAC values converted to RGB. Each band has 12 entries.
export const FUNKY_RGB: readonly [number, number, number][] = [
  [252, 0, 0], [252, 128, 40], [252, 0, 252], [252, 48, 48], [252, 0, 120],
];

/** Scope the DOS current-projectile globals to this effect, including volleys. */
export function stepWeaponEffect(state: BState, proj: BProjectile): void {
  const effect = proj.weaponEffect;
  if (!effect || !proj.active) return;
  const shooter = state.current_shooter;
  const weapon = state.current_weapon;
  state.current_shooter = proj.owner;
  state.current_weapon = proj.weapon;
  try {
    if (effect.kind === "death") stepDeathEffect(state, proj, effect);
    else if (effect.kind === "funky") stepFunky(state, proj, effect);
    else if (effect.kind === "sandhog") {
      // Fixed visual cadence, independent of ballistic substeps and CPU speed.
      for (let i = 0; i < 16 && effect.tunnels.length; i++) stepSandhogTick(state, proj, effect);
      effect.charges.forEach((c) => c.age++);
      effect.charges = effect.charges.filter((c) => c.age < 6);
      proj.active = effect.tunnels.length > 0 || effect.charges.length > 0;
    } else stepCombatEffect(state, proj, effect);
    // Notify at cleanup, not impact or each terrain write. Funky's terminal
    // blast supplies its own notification; Plasma never changes the ground.
    // Death effects and Earth Disrupter already request (forced) settling.
    if (!proj.active && effect.kind !== "funky" && effect.kind !== "death" &&
        !(effect.kind === "blast" && effect.plasma) &&
        !(effect.kind === "soil" && effect.mode === "disrupt")) state.request_terrain_settle?.();
  } finally {
    state.current_shooter = shooter;
    state.current_weapon = weapon;
  }
}

export function startFunky(state: BState, proj: BProjectile, x: number, y: number, spread: "impact" | "field" = "impact"): void {
  const count = 5 + state.rng.pick(6); // 2dce:01c5
  const extent = Math.abs(proj.weapon.blast);
  // 2dce:01e9: death case 271b:01f2 passes -1 for the entire clip width.
  const targets = Array.from({ length: count }, () => spread === "field"
    ? 1 + state.rng.pick(state.terrain.w - 3)
    : Math.max(1, Math.min(state.terrain.w - 2, x + state.rng.pick(2 * extent) - extent)));
  proj.weaponEffect = {
    kind: "funky", age: 0, x, y, targets, index: -1, phase: "grow", hold: 0, arc: null,
    trails: [], bursts: [{ x, y, radius: 20, grown: 0, color: 0 }],
  };
  proj.px = proj.sx = x;
  proj.py = proj.sy = y;
  proj.vx = proj.vy = 0;
}

/** 2dce:05df: signed 16.16 quarter-ellipse recurrence. This is NOT normal
 * projectile physics or a random scatter of instantaneous explosions. */
export function funkyArc(x: number, y: number, endX: number, floor: number, top: number): Arc {
  const midX = (x + endX) >> 1;
  const ax = midX - endX, ay = top - floor;
  const bx = midX - x, by = top - y;
  let span = 804, shift = 10;
  const length = Math.abs(ax) + Math.abs(ay) + Math.abs(bx) + Math.abs(by);
  while (span > length && shift > 0) { span = Math.trunc(span / 2); shift--; }
  return {
    ax: ax << 16, ay: ay << 16, bx: bx << 16, by: by << 16,
    ox: (x - ax) << 16, oy: (y - ay) << 16,
    shift, left: (102944 << shift) >> 16, lastX: -1, lastY: -1,
  };
}

export function nextArcPoint(a: Arc): Point | null {
  while (a.left-- >= 0) {
    const x = ((a.ax + a.ox) | 0) >> 16;
    const y = ((a.ay + a.oy) | 0) >> 16;
    a.bx = (a.bx - (a.ax >> a.shift)) | 0;
    a.by = (a.by - (a.ay >> a.shift)) | 0;
    a.ax = (a.ax + (a.bx >> a.shift)) | 0;
    a.ay = (a.ay + (a.by >> a.shift)) | 0;
    if (x !== a.lastX || y !== a.lastY) {
      a.lastX = x; a.lastY = y;
      return [x, y];
    }
  }
  return null;
}

function stepFunky(state: BState, proj: BProjectile, e: FunkyEffect): void {
  e.age++;
  if (e.phase === "grow") {
    const burst = e.bursts[e.bursts.length - 1];
    burst.grown = Math.min(burst.radius, burst.grown + 3);
    if (burst.grown < burst.radius) return;
    damage.explode(state, burst.x, burst.y, burst.radius, false);
    // DOS leaves colored blast pixels until the cleanup pass; the overlay
    // renders those pixels while the terrain underneath is cleared here.
    state.terrain.carve_circle(burst.x, burst.y, burst.radius);
    e.index++;
    if (e.index === e.targets.length) { e.phase = "hold"; return; }
    e.arc = funkyArc(e.x, e.y, e.targets[e.index], state.terrain.h - 2, 1);
    e.trails.push([]);
    e.phase = "arc";
  }
  if (e.phase === "arc") {
    const trail = e.trails[e.trails.length - 1];
    for (let i = 0; i < 64; i++) {
      const point = nextArcPoint(e.arc!);
      const [x, y] = point ?? [e.targets[e.index], state.terrain.h - 2];
      const inBurst = e.bursts.some((b) => (b.x - x) ** 2 + (b.y - y) ** 2 < b.radius ** 2);
      const tank = state.tanks.some((t) => t.alive && Math.abs(t.x - x) <= t.half_width && y >= t.y - 6 && y <= t.y);
      if (!point || x <= 0 || x >= state.terrain.w - 1 || y <= 1 || y >= state.terrain.h - 2 ||
          (!inBurst && (state.terrain.is_solid(x, y) || tank))) {
        e.bursts.push({
          x: Math.max(1, Math.min(state.terrain.w - 2, x)),
          y: Math.max(1 + 1, Math.min(state.terrain.h - 2, y)),
          radius: Math.max(1, pyRound((15 + state.rng.pick(10)) * state.explosion_scale)),
          grown: 0, color: e.index % 5,
        });
        e.phase = "grow";
        return;
      }
      trail.push([x, y]);
    }
  } else if (e.phase === "hold" && ++e.hold >= 39) {
    // 2dce:05c5: final ordinary blast, radius from Baby Nuke's effective entry.
    const radius = pyRound(40 * state.explosion_scale);
    startBlast(state, proj, e.x, e.y, radius);
    proj.active = false;
  }
}

export function startSandhog(state: BState, proj: BProjectile, x: number, y: number, digger = false): void {
  const tunnel: Tunnel = { x, y, next: null, direction: 0, straight: 20 };
  const effect: SandhogEffect = {
    kind: "sandhog", digger, tunnels: [tunnel], remaining: (digger ? Math.abs(proj.weapon.blast) * 2 : proj.weapon.warheads) - 1,
    branchClock: 0, spawned: 1, charges: [],
  };
  chooseTunnelStep(state, tunnel, digger);
  proj.weaponEffect = effect;
  proj.px = proj.sx = x;
  proj.py = proj.sy = y;
  proj.vx = proj.vy = 0;
}

function wrapX(state: BState, x: number): number {
  // The DOS wrap toggle is independent of the ballistic wall bounce handler.
  const cfg = state.cfg as BState["cfg"] & { elastic?: number; live_elastic?: number };
  if ((cfg.live_elastic ?? cfg.elastic) === 1) {
    if (x < 1) return state.terrain.w - 2;
    if (x > state.terrain.w - 2) return 1;
  }
  return x;
}

function chooseTunnelStep(state: BState, t: Tunnel, digger = false): void {
  const choices: number[] = [];
  TUNNEL_DIRECTIONS.forEach(([dx, dy], i) => {
    const x = wrapX(state, t.x + dx), y = t.y + dy;
    if (x > 0 && x < state.terrain.w - 1 && y > 1 && y < state.terrain.h - 1 && state.terrain.is_dirt(x, y)) choices.push(i);
  });
  if (!choices.length) { t.next = null; return; }
  let direction = choices[state.rng.pick(choices.length)];
  // RNG is still consumed when the persistence rule overrides the choice.
  if (!digger && choices.includes(t.direction)) {
    if (--t.straight < 1) t.straight = 20;
    else direction = t.direction;
  }
  t.direction = direction;
  const [dx, dy] = TUNNEL_DIRECTIONS[direction];
  t.next = [wrapX(state, t.x + dx), t.y + dy];
}

export function stepSandhogTick(state: BState, proj: BProjectile, e: SandhogEffect): void {
  // 251b:0665: widen randomly BEFORE advancing any head.
  for (const t of e.tunnels) {
    if (state.rng.pick(3) !== 1) continue;
    const [dx, dy] = TUNNEL_SIDES[t.direction];
    for (const sign of [-1, 1]) {
      const x = t.x + sign * dx, y = t.y + sign * dy;
      if (state.terrain.is_dirt(x, y)) state.terrain.write(x, y, C.COL_SKY);
    }
  }
  for (let i = 0; i < e.tunnels.length; i++) {
    const t = e.tunnels[i];
    if (t.next) [t.x, t.y] = t.next;
    chooseTunnelStep(state, t, e.digger);
    state.terrain.write(t.x, t.y, C.COL_SKY);
    if (!t.next) {
      if (!e.digger) {
      const radius = Math.max(1, pyRound(10 * state.explosion_scale));
      const pixels: Point[] = [];
      const marked = new Set<number>();
      // The charge really removes a random stipple of dirt. Raster callbacks
      // repeat on shared scanlines; preserve those RNG draws (4c70:09ca).
      const span = (half: number, dy: number) => {
        const y = t.y + dy;
        if (y < 2 || y > state.terrain.h - 2) return;
        for (let rawX = t.x - half; rawX <= t.x + half; rawX++) {
          const x = wrapX(state, rawX);
          if (x < 1 || x > state.terrain.w - 2) continue;
          if (state.rng.pick(2) === 1) {
            state.terrain.write(x, y, C.COL_SKY);
            const key = x * state.terrain.h + y;
            if (!marked.has(key)) { marked.add(key); pixels.push([x, y]); }
          }
        }
      };
      const diskRows = (a: number, b: number) => {
        span(a, b); span(a, -b); span(b, a); span(b, -a);
      };
      let a = 0, b = 2 * radius, error = 0;
      while (a <= b) {
        if ((a & 1) === 0) diskRows(a >> 1, (b + 1) >> 1);
        error += 2 * a + 1;
        a++;
        if (error > 0) { error -= 2 * b - 1; b--; }
      }
      diskRows(a >> 1, (b + 1) >> 1);
      // 251b:0239..0275: radius falloff multiplied by (weapon index + 1).
      // The last argument to apply_tank_damage remains the normal shield gate.
      for (const tank of state.tanks) {
        if (!tank.alive) continue;
        const d = Math.sqrt((tank.x - t.x) ** 2 + (tank.y - t.y) ** 2);
        if (d < radius) damage.apply_tank_damage(state, tank,
          pyRound((radius - d) * 100 / radius) * (proj.weapon.idx + 1));
      }
      e.charges.push({ x: t.x, y: t.y, radius, age: 0, pixels });
      }
      // Removal swaps in the last record; preserve DOS iteration/RNG order.
      e.tunnels[i] = e.tunnels[e.tunnels.length - 1];
      e.tunnels.pop();
      i--;
    }
  }
  if (e.remaining > 0 && e.tunnels.length < 20 && ++e.branchClock % 8 === 0 && e.tunnels.length) {
    const parent = e.tunnels[state.rng.pick(e.tunnels.length)];
    const child: Tunnel = {
      x: parent.x, y: parent.y, next: null, direction: (parent.direction + 1) % 8, straight: 20,
    };
    chooseTunnelStep(state, child, e.digger);
    if (child.next) {
      e.tunnels.push(child); e.remaining--; e.spawned++; e.branchClock = 0;
    }
  }
}
