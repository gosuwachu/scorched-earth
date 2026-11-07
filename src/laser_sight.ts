/** Browser-only aiming aid; no trajectory prediction or simulation changes. */
import { TANK_TURRET, TANK_WORD0, NUM_TANK_DESIGNS } from "./sprites_data";
import { AI_HUMAN } from "./constants";
import { SLOT_LASER_SIGHT } from "./weapons";
import { modernBarrel } from "./modern_art";
import type { Tank } from "./render";

type SightTank = Pick<Tank, "alive" | "ai_class" | "chute_descent" | "inventory">;
interface SightState {
  phase: string;
  current_shooter: unknown;
  projectiles: { owner?: unknown }[];
  sim_settling?: unknown;
}

export function sightVisible(state: SightState, tank: SightTank): boolean {
  if (!tank.alive || tank.ai_class !== AI_HUMAN || tank.chute_descent ||
      !(tank.inventory[SLOT_LASER_SIGHT] > 0) || state.sim_settling) return false;
  if (state.phase === "sim_live") {
    return !state.projectiles.some((p) => p.owner === tank);
  }
  return state.phase === "aim" && state.current_shooter === tank;
}

export function sightLine(tank: Pick<Tank, "x" | "y" | "angle" | "tank_icon">, modernWidth?: number) {
  const raw = Math.trunc(tank.tank_icon ?? 0);
  const design = raw >= 0 && raw < NUM_TANK_DESIGNS ? raw : 0;
  const [mx, my] = TANK_TURRET[design];
  const radians = tank.angle * Math.PI / 180;
  const dx = Math.cos(radians), dy = -Math.sin(radians);
  const barrel = TANK_WORD0[design];
  let x1: number, y1: number;
  if (modernWidth !== undefined) {
    const geometry = modernBarrel(tank.tank_icon ?? 0), scale = modernWidth / 26;
    x1 = tank.x + dx * geometry.length * scale;
    y1 = tank.y + (geometry.pivotY + dy * geometry.length) * scale;
  } else {
    // Canvas strokes use pixel centres; match the sprite's rounded muzzle pixel.
    x1 = tank.x + mx + Math.round(dx * barrel) + 0.5;
    y1 = tank.y + my - Math.round(-dy * barrel) + 0.5;
  }
  return { x1, y1, x2: x1 + dx * 100, y2: y1 + dy * 100 };
}
