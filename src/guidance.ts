/** DOS 1.5 guidance. See oracle/GUIDANCE_FIDELITY.md for addresses and limits.
 * The historical Python blend-based steering is deliberately superseded. */
import { maxPower } from "./power";
import { PHYSICS_DT, EFF_GRAVITY_FACTOR, EFF_WIND_FACTOR, PLAYMODE_SIMULTANEOUS } from "./constants";
import { pyRound, type Projectile, type Tank } from "./objects";
import type { Item } from "./weapons";

export interface GuidanceCfg {
  GRAVITY: number;
  wind: number;
  viscosity_mult: number;
  EDGES_EXTEND: number;
  live_elastic?: number;
  elastic?: number;
  play_mode?: number;
}
export interface GuidanceState { cfg: GuidanceCfg; w: number; h: number; }
export interface Guidance {
  type: "heat" | "ballistic" | "horizontal" | "vertical" | "lazyboy";
  target: Tank | null;
  point: [number, number] | null;
  tanks: Tank[] | null;
  armed: boolean;
  _last_x: number | null;
  _last_y: number | null;
  directionX?: number;
  directionY?: number;
  arrival?: boolean;
  travel?: number;
}
const types: Guidance["type"][] = ["heat", "ballistic", "horizontal", "vertical", "lazyboy"];
export const _IGNORES_GUIDANCE: ReadonlySet<string> = new Set(["mirv", "riot_wedge", "riot_sphere", "plasma"]);
/** DS:5186; acquisition is round(distance) < 40, in tank-array order. */
export const HEAT_RANGE = 40;
export const LAZY_SPEED = 500; // DS:31fc
export const GUIDANCE_ACCEL = 10000; // DS:3224; horizontal uses DS:3228 = 15000
export function compatible(weapon: Item): boolean { return !_IGNORES_GUIDANCE.has(weapon.behavior); }
export function isGuidance(slot: unknown): slot is number {
  return typeof slot === "number" && Number.isInteger(slot) && slot >= 33 && slot <= 37;
}
export function needsTarget(slot: unknown): boolean { return isGuidance(slot) && slot !== 33; }
export function team_mode_active(a: unknown, b: unknown): boolean {
  const ta = (a as { team_id?: number } | null)?.team_id ?? 0;
  return ta !== 0 && ta === ((b as { team_id?: number } | null)?.team_id ?? 0);
}
export function attach(tank: Tank, cfg: GuidanceCfg, weapon: Item, proj: Projectile): Guidance | null {
  const slot = tank.selected_guidance;
  if (!isGuidance(slot) || !compatible(weapon) || cfg.play_mode === PLAYMODE_SIMULTANEOUS || !(tank.inventory[slot] > 0)) {
    proj.guidance = null;
    return null;
  }
  const target = tank.guidance_target as Tank | null;
  const point = tank.guidance_target_pt as [number, number] | null;
  const g: Guidance = {
    type: types[slot - 33], target,
    point: point ? [...point] : target ? [target.x, target.y] : null,
    tanks: null, armed: false, _last_x: null, _last_y: null,
  };
  proj.guidance = g;
  // 2a4a:08f6..0910 forces contact for all non-ballistic guidance, even
  // before acquisition. This costs no Contact Trigger inventory.
  if (g.type !== "ballistic") proj.contact = true;
  return g;
}

/** 2e50:099c / 0c30: acceleration toward a fixed point, not a velocity snap.
 * Crossing either enabled axis ends Heat's callback, or detonates Horz/Vert. */
export function apply(proj: Projectile, _cfg: GuidanceCfg, tanks: Tank[] | null = null, dt = PHYSICS_DT): boolean {
  const g = proj.guidance as Guidance | null;
  if (!g) return true;
  if (tanks) g.tanks = tanks;
  if (!g.armed || !g.point || g.type === "lazyboy" || g.type === "ballistic") return true;
  const dx = g.point[0] - proj.px, dy = g.point[1] - proj.py;
  if ((g.directionX && dx * g.directionX > 0) || (g.directionY && dy * g.directionY > 0)) {
    if (g.type === "heat") proj.guidance = null;
    else g.arrival = true;
    return !g.arrival;
  }
  const d2 = dx * dx + dy * dy;
  if (d2 >= 0.001) {
    const scale = (g.type === "horizontal" ? 15000 : GUIDANCE_ACCEL) * dt / Math.sqrt(Math.sqrt(d2));
    proj.vx += dx * scale;
    proj.vy -= dy * scale;
  }
  return true;
}

export interface GuidanceWorld {
  tanks: Tank[];
  w: number;
  h: number;
  cfg: GuidanceCfg;
  terrain: { is_dirt(x: number, y: number): boolean };
}

/** 4bac:010c/022c: on ascent a horizontal lane must be unobstructed.
 * Descending shells select the direct lane (or shorter open wrap lane). */
function horizontalDirection(world: GuidanceWorld, proj: Projectile, tx: number, x: number, y: number): number {
  const wrap = (world.cfg.live_elastic ?? world.cfg.elastic) === 1;
  let dir = x >= tx ? 1 : -1; // +0x66 is origin-minus-target sign
  const clear = (sign: number): boolean => {
    for (let xx = x - sign, n = 0; n < world.w; xx -= sign, n++) {
      if (xx < 0 || xx >= world.w) { if (!wrap) return false; xx = (xx + world.w) % world.w; }
      if (xx === tx) return true;
      if (world.tanks.some((t) => t.alive && Math.abs(t.x - xx) <= t.half_width && y <= t.y && y >= t.y - 10)) return true;
      if (world.terrain.is_dirt(xx, y)) return false;
    }
    return false;
  };
  if (wrap && Math.abs(x - tx) > world.w / 2) dir = -dir;
  if (proj.vy < 0 && !wrap) return dir;
  if (clear(dir)) return dir;
  return wrap && clear(-dir) ? -dir : 0;
}

/** Called at each swept pixel AFTER ordinary collision checks (2a4a:1791).
 * A true return stops the sweep at the activation/arrival pixel. */
export function visit(proj: Projectile, world: GuidanceWorld, x: number, y: number): boolean {
  const g = proj.guidance as Guidance | null;
  if (!g || g.type === "ballistic" || g.type === "lazyboy") return false;
  if (g.armed) {
    if (g.point?.[0] === x && g.point[1] === y) { g.arrival = true; return true; }
    return false;
  }
  if (g.type === "heat") {
    // 2e50:0001 excludes only the owner and dead tanks, not team-mates.
    const target = world.tanks.find((t) => t.alive && t !== proj.owner && pyRound(Math.hypot(t.x - x, t.y - y)) < HEAT_RANGE);
    if (!target) return false;
    g.target = target; g.point = [target.x, target.y];
  } else if (!g.point || (g.type === "horizontal" ? y !== g.point[1] : x !== g.point[0])) return false;
  const [tx, ty] = g.point!;
  g.directionX = g.type === "vertical" ? 0 : g.type === "horizontal" ? horizontalDirection(world, proj, tx, x, y) : x >= tx ? 1 : -1;
  if (g.type === "horizontal" && g.directionX === 0) return false;
  g.directionY = g.type === "horizontal" ? 0 : y >= ty ? 1 : -1;
  g.armed = true;
  proj.px = proj.sx = x; proj.py = proj.sy = y;
  return true;
}

/** 2e50:00cf uses DDA steps of <=1px on the major axis, 500 steps/second.
 * The game checks each step for tank contact and target arrival. */
export function lazyStep(proj: Projectile, world: GuidanceWorld): [number, number] | null {
  const g = proj.guidance as Guidance | null;
  if (!g?.point) return null;
  const [tx, ty] = g.point;
  const dx = tx - proj.px, dy = ty - proj.py, major = Math.max(Math.abs(dx), Math.abs(dy));
  if (major === 0) { g.arrival = true; return null; }
  let ux = dx / major, uy = dy / major;
  let x = pyRound(proj.px + ux), y = pyRound(proj.py + uy);
  // DOS treats both soil and intervening tank pixels as obstacles, except
  // pixels belonging to the chosen tank. Shields are not part of this callback.
  const tank = world.tanks.find((t) => t.alive && Math.abs(x - t.x) <= t.half_width && y >= t.y - 10 && y <= t.y);
  if (tank ? tank !== g.target : world.terrain.is_dirt(x, y)) {
    if (x !== proj.sx) {
      if (proj.sy <= 0) uy = 0;
      else { ux = 0; uy = -1; }
    }
    x = pyRound(proj.px + ux); y = pyRound(proj.py + uy);
    // A dirt pixel remaining in the escape direction is excavated by the game hook.
  }
  proj.prev_px = proj.px; proj.prev_py = proj.py;
  proj.px += ux; proj.py += uy; proj.sx = x; proj.sy = y;
  proj.saved_vx = proj.vx = ux; proj.saved_vy = proj.vy = -uy;
  if (x === tx && y === ty) g.arrival = true;
  return [x, y];
}

/** Algebraic form of 2e50:05e9's acceleration-axis rotation. DOS flag=0
 * takes abs(v²) for an impossible trajectory; UI power adjustment then caps it.
 * Use the port's launch geometry and acceleration units, including wind. */
export function solve_ballistic_power_launch(cfg: GuidanceCfg, tank: Tank, _weapon: Item): number | null {
  const target = tank.guidance_target as Tank | null;
  const pt = tank.guidance_target_pt as [number, number] | null;
  if (!pt && !target) return null;
  const [tx, ty] = pt ?? [target!.x, target!.y];
  let angle = tank.angle;
  for (let tries = 0; tries < 2; tries++, angle++) {
    const rad = angle * 0.017453293, c = Math.cos(rad), s = Math.sin(rad);
    const dx = tx - (tank.x + 12 * c), up = tank.y - 4 - 12 * s - ty;
    const gravity = EFF_GRAVITY_FACTOR * cfg.GRAVITY, wind = EFF_WIND_FACTOR * cfg.wind;
    const time2 = 2 * (dx * s - up * c) / (gravity * c + wind * s);
    const cap = maxPower(tank.health);
    if (!Number.isFinite(time2) || Math.abs(time2) < 1e-12) continue;
    const t = Math.sqrt(Math.abs(time2));
    const speed = Math.abs(c) > 1e-8 ? Math.abs((dx - wind * time2 / 2) / (t * c)) : Math.abs((up + gravity * time2 / 2) / (t * s));
    return Math.min(cap, Math.max(0, pyRound(speed)));
  }
  return maxPower(tank.health);
}
export function solve_ballistic_power(state: GuidanceState, tank: Tank, weapon: Item): number | null {
  return solve_ballistic_power_launch(state.cfg, tank, weapon);
}
