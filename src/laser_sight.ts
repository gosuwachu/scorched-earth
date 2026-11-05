/** Browser-only aiming aid; no trajectory prediction or simulation changes. */
import { TANK_TURRET, TANK_WORD0, NUM_TANK_DESIGNS } from "./sprites_data";
import { AI_HUMAN } from "./constants";
import { SLOT_LASER_SIGHT } from "./weapons";
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

export function sightLine(tank: Pick<Tank, "x" | "y" | "angle" | "tank_icon">) {
  const raw = Math.trunc(tank.tank_icon ?? 0);
  const design = raw >= 0 && raw < NUM_TANK_DESIGNS ? raw : 0;
  const [mx, my] = TANK_TURRET[design];
  const radians = tank.angle * Math.PI / 180;
  const dx = Math.cos(radians), dy = -Math.sin(radians);
  const barrel = TANK_WORD0[design];
  const x = tank.x + mx, y = tank.y + my;
  return { x1: x + dx * barrel, y1: y + dy * barrel,
    x2: x + dx * (barrel + 100), y2: y + dy * (barrel + 100) };
}
