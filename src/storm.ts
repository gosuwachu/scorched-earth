/** 480f:0219/0390 and its pixel callback 000c. Lightning starts at a random
 * sky position, bends during the line walk, and stops at dirt or a tank. */
import * as C from "./constants";
import * as damage from "./damage";
import type { State } from "./hazard";

export function stormBolt(state: State, startX?: number): Array<Array<[number, number]>> {
  const lines: Array<Array<[number, number]>> = [];
  const floor = state.terrain.h - 2;
  const x0 = startX ?? state.rng.pick(Math.max(1, state.w - 53)) + 25;
  let branches = 0, budget = 8192;
  // Explicit continuations preserve the recursive DOS draw order without
  // consuming the JS call stack when several bends occur at the same pixel.
  const pending = [{ x: x0, y: 2, phase: 0 }];
  while (pending.length) {
    let { x, y, phase } = pending.pop()!;
    if (phase) {
      if (branches < 13 && state.rng.pick(10) > 7) {
        branches++;
        if (phase === 1) pending.push({ x, y, phase: 2 });
        pending.push({ x, y, phase: 0 });
      }
      continue;
    }
    if (y >= floor || budget-- <= 0) continue;
    state.rng.pick(50); // speaker pitch
    const end = x + state.rng.pick(floor - y + 1) - ((floor - y) >> 1);
    const dx = Math.abs(end - x), sx = x < end ? 1 : -1, dy = -(floor - y);
    let error = dx + dy;
    const path: Array<[number, number]> = [];
    let bend = false;
    while (budget-- > 0) {
      if (x < 1 || x > state.w - 2) break;
      const tank = state.tanks.find((t) => t.alive && Math.abs(t.x - x) <= t.half_width && y >= t.y - 10 && y <= t.y);
      if (tank) {
        if (state.cfg.is_on("HOSTILE_ENVIRONMENT")) {
          const previous = state.current_shooter;
          state.current_shooter = null;
          try { damage.apply_tank_damage(state as unknown as damage.State, tank as unknown as damage.Tank, 10); }
          finally { state.current_shooter = previous; }
        }
        path.push([x, y]); break;
      }
      if (C.is_dirt(state.terrain.read(x, y))) {
        state.terrain.write(x, y, 81 + state.rng.pick(5));
        path.push([x, y]); break;
      }
      path.push([x, y]);
      if (y >= floor) break;
      if (state.rng.pick(10) === 2) { bend = true; break; }
      const e = 2 * error;
      if (e >= dy) { error += dy; x += sx; }
      if (e <= dx) { error += dx; y++; }
    }
    if (path.length > 1) lines.push(path);
    if (bend && budget > 0) pending.push({ x, y, phase: 1 }, { x, y, phase: 0 });
  }
  return lines;
}
