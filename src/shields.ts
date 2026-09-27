/** DOS shield outlines: 4912:09a9, definition radii at 5f38:617c..61bc.
 * Render and swept collision share these integer pixels; Canvas arcs must not
 * introduce visible shield pixels which a projectile can pass through. */
import { ITEMS, SLOT_MAG_DEFLECTOR, SLOT_SHIELD, SLOT_FORCE_SHIELD, SLOT_HEAVY_SHIELD, SLOT_SUPER_MAG } from "./weapons";

type RGB = [number, number, number];
// Shield definitions at 5f38:617c..61bc, +6/+8/+a: VGA DAC channels, not team hues.
const colors6: Readonly<Record<number, RGB>> = {
  [SLOT_MAG_DEFLECTOR]: [63, 63, 23],
  [SLOT_SHIELD]: [63, 63, 63],
  [SLOT_FORCE_SHIELD]: [63, 23, 63],
  [SLOT_HEAVY_SHIELD]: [63, 63, 63],
  [SLOT_SUPER_MAG]: [63, 53, 33],
};

export interface ShieldFade {
  dir: number;
  frame: number;
  item: number;
  hp: number;
  x: number;
  y: number;
}

export interface ShieldVisualState {
  shield_fades?: Record<number, ShieldFade>;
}

interface ShieldTank {
  player_index: number;
  shield_item: number;
  shield_hp: number;
  x: number;
  y: number;
}

export const SHIELD_FADE_SAMPLES = 51;

/** Capture the old equipment and position BEFORE a collapse clears them. */
export function startShieldFade(state: ShieldVisualState, tank: ShieldTank, dir: number): void {
  if (!state.shield_fades) return;
  state.shield_fades[tank.player_index] = {
    dir, frame: 0, item: tank.shield_item, hp: tank.shield_hp, x: tank.x, y: tank.y,
  };
}

export function stopShieldFade(state: ShieldVisualState, tank: { player_index: number }): void {
  if (state.shield_fades) delete state.shield_fades[tank.player_index];
}

/** 4191:0034/06ca: integer strength scaling in SIX-bit DAC space, then <<2.
 * 4191:0455 activates with two integer divisions; 0034 collapses from full
 * brightness through sample 50/60, then erases. Browser timing is 60 Hz. */
export function shieldColor(item: number, hp: number, fade?: ShieldFade): RGB {
  const base = colors6[item];
  if (!base) return [0, 0, 0];
  const maximum = ITEMS[item].params.hp as number;
  const strength = Math.max(0, Math.min(maximum, hp));
  const animated = fade && fade.item === item && (fade.dir < 0 || fade.hp === hp);
  const frame = Math.max(0, Math.min(50, fade?.frame ?? 0));
  return base.map((channel) => {
    const value = animated
      ? fade.dir > 0
        ? Math.floor(channel * Math.floor(frame * 63 / 50) / 63)
        : Math.floor(channel * (60 - frame) / 60)
      : Math.floor(channel * strength / maximum);
    return value << 2;
  }) as RGB;
}

type Point = readonly [number, number];
const outlines = new Map<number, { points: Point[]; keys: Set<number> }>();
const key = (x: number, y: number) => (y + 16) * 33 + x + 16;

function outline(item: number): { points: Point[]; keys: Set<number> } {
  const cached = outlines.get(item);
  if (cached) return cached;
  const radii = item === SLOT_MAG_DEFLECTOR ? [13, 16]
    : item === SLOT_HEAVY_SHIELD || item === SLOT_SUPER_MAG ? [16, 15]
    : item === SLOT_SHIELD || item === SLOT_FORCE_SHIELD ? [15] : [];
  const points: Point[] = [], keys = new Set<number>();
  const plot = (x: number, y: number) => {
    // 4912:095c: Mag Deflector displays only the two small overhead arcs.
    if (item === SLOT_MAG_DEFLECTOR && (x <= -5 || x >= 5 || y >= 0)) return;
    const k = key(x, y);
    if (!keys.has(k)) { keys.add(k); points.push([x, y]); }
  };
  const octants = (x: number, y: number) => {
    for (const [dx, dy] of [[x, y], [-x, y], [x, -y], [-x, -y], [y, x], [-y, x], [y, -x], [-y, -x]]) plot(dx, dy);
  };
  for (const r of radii) {
    // 4c70:026f: doubled-coordinate integer circle, eight-way plot at 01ed.
    let x = 0, y = 2 * r, error = 0;
    while (x <= y) {
      if ((x & 1) === 0) octants(x >> 1, (y + 1) >> 1);
      error += 2 * x + 1;
      x++;
      if (error > 0) { error -= 2 * y - 1; y--; }
    }
    octants(x >> 1, (y + 1) >> 1);
  }
  const result = { points, keys };
  outlines.set(item, result);
  return result;
}

export function shieldPixels(item: number): readonly Point[] { return outline(item).points; }

export function shieldContains(item: number, dx: number, dy: number): boolean {
  return Math.abs(dx) <= 16 && Math.abs(dy) <= 16 && outline(item).keys.has(key(dx, dy));
}
