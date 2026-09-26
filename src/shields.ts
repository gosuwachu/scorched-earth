/** DOS shield outlines: 4912:09a9, definition radii at 5f38:617c..61bc.
 * Render and swept collision share these integer pixels; Canvas arcs must not
 * introduce visible shield pixels which a projectile can pass through. */
import { SLOT_MAG_DEFLECTOR, SLOT_SHIELD, SLOT_FORCE_SHIELD, SLOT_HEAVY_SHIELD, SLOT_SUPER_MAG } from "./weapons";

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
