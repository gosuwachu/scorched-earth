// Browser consistency checks for the new equipment, not DOS evidence.
import { GameState } from "../src/game";
import { Renderer } from "../src/render";
import { Surface } from "../src/pygame";
import { SLOT_LASER_SIGHT } from "../src/weapons";
import { sightLine } from "../src/laser_sight";

export function laserSightStates(build: (sky?: string) => GameState,
  renderer: (gs: GameState) => Renderer, blit: (surf: Surface) => void) {
  const states: Record<string, () => Record<string, string | number | boolean>> = {};
  for (const sky of ["BLACK", "PLAIN"]) for (const angle of [0, 45, 90, 135, 180]) {
    states[`laser_sight_${sky.toLowerCase()}_${angle}`] = () => {
      const gs = build(sky), t = gs.current_shooter!;
      t.x = 350; t.y = 380; t.angle = angle;
      const r = renderer(gs), surf = new Surface([gs.w, gs.h]);
      const baseline = new Surface([gs.w, gs.h]);
      r.render(baseline, gs, 0);
      t.inventory[SLOT_LASER_SIGHT] = 10;
      r.render(surf, gs, 0);
      const line = sightLine(t);
      const strength = (fraction: number) => {
        const x = Math.round(line.x1 + (line.x2 - line.x1) * fraction);
        const y = Math.round(line.y1 + (line.y2 - line.y1) * fraction);
        let delta = 0;
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
          const p = surf.get_at([x + a, y + b]), q = baseline.get_at([x + a, y + b]);
          delta += Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
        }
        return delta;
      };
      const near = strength(0.2), far = strength(0.85), beyond = strength(1.1);
      if (!(near > far && far > 0 && beyond === 0)) throw new Error(`Sight fade: ${near}, ${far}, ${beyond}`);
      if (t.inventory[SLOT_LASER_SIGHT] !== 10) throw new Error("Rendering spent a charge");
      blit(surf);
      return { angle, sky, near, far, beyond };
    };
  }
  return states;
}
