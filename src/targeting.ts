/** Shared host-owned firing request for local and online target selection. */
import { clampPower } from "./power";
import type { GameState } from "./game";
import type { Tank } from "./objects";
import { ITEMS } from "./weapons";
import { compatible, isGuidance, needsTarget } from "./guidance";
import { AI_HUMAN, PLAYMODE_SIMULTANEOUS, PLAYMODE_SYNCHRONOUS } from "./constants";

export interface TargetRequest {
  shooter: Tank;
  weapon: number;
  guidance: number;
  angle: number;
  power: number;
  point: [number, number] | null;
  target: Tank | null;
}
export function tanks(state: Pick<GameState, "tanks">): Tank[] {
  return state.tanks.filter((t) => t.alive).sort((a, b) => a.x - b.x || a.player_index - b.player_index);
}
export function usable(tank: Tank, weapon: number, mode: number): number | null {
  const slot = tank.selected_guidance;
  return mode !== PLAYMODE_SIMULTANEOUS && isGuidance(slot) && tank.inventory[slot] > 0 && compatible(ITEMS[weapon]) ? slot : null;
}
export function begin(state: GameState): boolean {
  const t = state.current_shooter;
  if (!t || state.phase !== "aim" || t.ai_class !== AI_HUMAN) return false;
  if (state.pendingTarget) return true;
  const weapon = t.has_ammo(t.selected_weapon) ? t.selected_weapon : 0;
  const guidance = usable(t, weapon, state.cfg.play_mode);
  if (guidance === null || !needsTarget(guidance)) return false;
  t.power = clampPower(t.health, t.power);
  state.pendingTarget = { shooter: t, weapon, guidance, angle: t.angle, power: t.power, point: null, target: null };
  t.guidance_target = null; t.guidance_target_pt = null;
  return true;
}
export function setPoint(state: GameState, x: number, y: number, target: Tank | null = null): boolean {
  const pending = state.pendingTarget;
  if (!pending || state.current_shooter !== pending.shooter || state.phase !== "aim" ||
      !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= state.w || y < 0 || y >= state.h - 1 ||
      (target && (!target.alive || !state.tanks.includes(target)))) return false;
  pending.point = [x, y]; pending.target = target;
  return true;
}
export function selectTank(state: GameState, tank: Tank): boolean {
  return setPoint(state, tank.x, tank.y, tank);
}
export function cancel(state: GameState): void { state.pendingTarget = null; }
export function confirm(state: GameState): boolean {
  const p = state.pendingTarget;
  if (!p?.point || state.current_shooter !== p.shooter || state.phase !== "aim" || !p.shooter.alive ||
      (p.target && !p.target.alive) || !(p.shooter.inventory[p.guidance] > 0) || !p.shooter.has_ammo(p.weapon)) return false;
  const t = p.shooter;
  t.angle = p.angle; t.power = clampPower(t.health, p.power); t.selected_weapon = p.weapon; t.selected_guidance = p.guidance;
  t.guidance_target = p.target; t.guidance_target_pt = [...p.point];
  state.pendingTarget = null;
  if (state.cfg.play_mode === PLAYMODE_SYNCHRONOUS) state._sync_human_fire(t);
  else state.fire(t);
  return true;
}
