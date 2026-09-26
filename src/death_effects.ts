/** Remaining death handlers from 271b:0543, 352c:00c9 and 4451:016f.
 * DOS palette pixels are represented separately from the terrain until cleanup. */
import { Projectile, type Tank } from "./objects";
import * as damage from "./damage";
import { sfx } from "./sound";
import { tankBodyPixels } from "./sprites";
import type { BProjectile, BState } from "./weapon_behaviors";

export interface DeathEffect {
  kind: "death";
  mode: "spiral" | "ring" | "sink" | "debris";
  x: number; y: number; clock: number; radius: number; angle: number;
  points: Map<number, number>;
  bubbles: Array<{ x: number; y: number; r: number }>;
  tank?: Tank;
  target: number;
  phase: "grow" | "clear";
  pieces: Array<{ x: number; y: number; vx: number; vy: number; color: number }>;
}

export function startDeathEffect(state: BState, shot: BProjectile, mode: DeathEffect["mode"], tank?: Tank): void {
  const floor = state.terrain.h - 2;
  let target = 0;
  if (mode === "sink") {
    const space = floor - shot.py;
    target = shot.py + 5 + state.rng.pick(Math.max(1, space > 10 ? space - 5 : space));
    if (target > floor || target < shot.py) target = floor - 5;
  }
  const e: DeathEffect = { kind: "death", mode, x: shot.px, y: shot.py, clock: 0,
    radius: mode === "spiral" ? 45 + state.rng.pick(60) : 30, angle: 0,
    points: new Map(), bubbles: [], tank, target, phase: "grow", pieces: [] };
  if (mode === "debris" && tank) {
    // 49d4:0177 includes both the design's pixels and its barrel line.
    const body = tankBodyPixels(48, 32, 24, 24, [1, 0, 0], tank.tank_icon, { angle: tank.angle });
    for (let x = 0; x < body.w; x++) for (let y = 0; y < body.h; y++) {
      const i = x * body.h + y;
      if (!body.alpha[i]) continue;
      // 3bf9:03f4 divides by the squared length of a sampled 3D vector.
      let a = 0, b = 0, length = 0;
      for (let attempt = 0; length < 0.001 && attempt < 100; attempt++) {
        a = state.rng.pick(16777216) / 16777216 - 0.5;
        b = state.rng.pick(16777216) / 16777216 - 0.5;
        const c = state.rng.pick(16777216) / 16777216 - 0.5;
        length = a * a + b * b + c * c;
      }
      length = Math.max(0.001, length);
      const color = body.rgb[i * 3] === 120 ? 7 : body.rgb[i * 3] === 252 ? 15 : tank.color;
      const px = shot.px + x - 24, py = shot.py + y - 24;
      e.pieces.push({ x: px, y: py, vx: a * 400 / length, vy: Math.abs(b * 400 / length), color });
      paint(state, e, px, py, color);
    }
  }
  const p = new Projectile(shot.owner as never, shot.weapon, shot.px, shot.py, 0, 0) as unknown as BProjectile;
  p.weaponEffect = e;
  state.projectiles.push(p);
}

function paint(state: BState, e: DeathEffect, x: number, y: number, color: number): void {
  const w = state.terrain.w;
  if ((state.cfg as BState["cfg"] & { live_elastic?: number }).live_elastic === 1)
    x = 1 + ((x - 1) % (w - 2) + w - 2) % (w - 2);
  if (x > 0 && x < w - 1 && y > 1 && y < state.terrain.h - 1) e.points.set(y * w + x, color);
}

function spiral(state: BState, shot: BProjectile, e: DeathEffect): void {
  const r = 5 + 2 * e.clock++;
  if (r >= e.radius) {
    for (const t of state.tanks) if (t.alive && (t.x !== e.x || t.y !== e.y) &&
      Math.sqrt((t.x - e.x) ** 2 + (t.y - e.y) ** 2) < e.radius) damage.apply_tank_damage(state, t, 20);
    e.phase = "clear";
    return;
  }
  // Four rays per radius, reflected into all four quadrants. Only one in four
  // visited pixels is painted (271b:0427), including pixels occupied by dirt.
  for (let ray = 0; ray < 4; ray++) {
    const a = e.angle * 0.017453293;
    const xx = damage.pyRound(r * Math.sin(a)), yy = damage.pyRound(r * Math.cos(a));
    e.angle += state.rng.pick(30);
    if (e.angle > 90) e.angle -= 90;
    let x = 0, y = 0, error = xx - yy;
    for (;;) {
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]])
        if (state.rng.pick(4) === 2) paint(state, e, e.x + sx * x, e.y + sy * y, 250);
      if (x === xx && y === yy) break;
      const d = 2 * error;
      if (d > -yy) { error -= yy; x++; }
      if (d < xx) { error += xx; y++; }
    }
  }
  sfx.beep(10000, 8, state.cfg.is_on("SOUND"));
}

function bubbles(state: BState, e: DeathEffect): void {
  if (!e.clock) e.bubbles.push({ x: e.x, y: e.y, r: 30 });
  const r = 20 - e.clock++;
  if (r <= 5) { e.phase = "clear"; return; }
  for (let n = 0; n < 4; n++) {
    const distance = state.rng.pick(40 - r), a = state.rng.pick(360) * 0.017453293;
    e.bubbles.push({ x: e.x + damage.pyRound(distance * Math.sin(a)),
      y: e.y + damage.pyRound(distance * Math.cos(a)), r });
    if (state.cfg.is_on("SOUND")) sfx.beep(state.rng.pick(50), 8, true);
  }
}

function sink(state: BState, e: DeathEffect): void {
  // Original sink performs ~38 speckle passes per one-pixel descent. Batch
  // those passes into a browser tick while retaining its two-zero toggle.
  if (e.y <= e.target) {
    for (let n = 0; n < 38; n++) {
      const roll = state.rng.pick(19);
      if (!roll) {
        if (++e.clock % 2 === 0) {
          e.y++;
          if (e.tank) e.tank.y = e.y;
          const span = state.rng.pick(9) - 4;
          if (span >= 0) for (let x = e.x; x <= e.x + span; x++) state.terrain.write(x, e.y, 0);
          for (let x = -6; x < 6; x++) paint(state, e, e.x + x, e.y + 2, 170 + state.rng.pick(5));
          for (let x = -4; x < 4; x++) paint(state, e, e.x + x, e.y + 3, 170 + state.rng.pick(5));
        }
      } else {
        if (roll === 1) paint(state, e, e.x + state.rng.pick(25) - 12, e.y, 170 + state.rng.pick(5));
        paint(state, e, e.x + roll - 9, e.y + (roll & 1), 170 + state.rng.pick(5));
      }
    }
    return;
  }
  // Last 200 sparks precede the narrow vertical cleanup (352c:049e..053b).
  for (let n = 0; n < 10; n++) paint(state, e, e.x + state.rng.pick(21) - 10,
    7 + state.rng.pick(Math.max(1, e.target - 7)), 185 + state.rng.pick(6));
  if (++e.angle >= 20) e.phase = "clear";
}

export function stepDeathEffect(state: BState, shot: BProjectile, e: DeathEffect): void {
  if (e.phase === "clear") {
    if (e.mode !== "debris")
      for (const key of e.points.keys()) state.terrain.write(key % state.terrain.w, Math.floor(key / state.terrain.w), 0);
    if (e.mode === "ring") for (const b of e.bubbles) state.terrain.carve_circle(b.x, b.y, b.r);
    shot.active = false;
    state.request_terrain_settle?.();
    return;
  }
  if (e.mode === "spiral") spiral(state, shot, e);
  else if (e.mode === "ring") bubbles(state, e);
  else if (e.mode === "sink") sink(state, e);
  else {
    // 37d2:05f3..0954: gravity 40, divisor 70. A fragment disappears on
    // reaching dirt (<105 in the DOS composited framebuffer). The browser
    // stores sky separately, so test terrain occupancy rather than its index.
    e.pieces = e.pieces.filter((p) => {
      p.vy -= 40;
      let x = p.x + p.vx / 70;
      const y = p.y - p.vy / 70, w = state.terrain.w;
      if ((state.cfg as BState["cfg"] & { live_elastic?: number }).live_elastic === 1)
        x = 1 + ((x - 1) % (w - 2) + w - 2) % (w - 2);
      const old = damage.pyRound(p.y) * w + damage.pyRound(p.x);
      const next = damage.pyRound(y) * w + damage.pyRound(x);
      if (old === next) return true;
      const live = y > 1 && y < state.terrain.h - 1 && x > 0 && x < w - 1 &&
        !state.terrain.is_dirt(damage.pyRound(x), damage.pyRound(y));
      e.points.delete(old);
      if (!live) return false;
      p.x = x; p.y = y; e.points.set(next, p.color);
      return true;
    });
    if (!e.pieces.length) e.phase = "clear";
  }
}
