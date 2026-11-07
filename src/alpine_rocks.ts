/** Browser-only alpine dressing, using the shared destructible rock mask. */
import { hash, type ModernWorld, type Prop } from "./modern";
import { rockContains, rockTop } from "./modern_rocks";

export function placeAlpineRocks(m: ModernWorld, tanks: ReadonlyArray<{ x: number; half_width: number }>): void {
  const scale = Math.max(.6, Math.min(1.5, m.w / 640));
  // Reserve cave space for boulders before filling gaps with smaller scree.
  for (let piece = 0; piece < 4; piece++) {
    for (let n = 0, anchor = 18; anchor < m.w - 18; n++, anchor += 22 * scale) {
      const center = anchor + hash(n, 601, m.seed) * 14 * scale;
      if (m.props.length >= 180) return;
      const rnd = hash(n, 612 + piece, m.seed);
      const w = (piece === 0 ? 18 + rnd * 16 : 3 + rnd * 8) * scale;
      const h = w * (.55 + hash(n, 625 + piece, m.seed) * .28);
      const px = Math.round(center + (piece === 0 ? 0 : (piece - 2) * 13 * scale + rnd * 8));
      if (px - w / 2 < 1 || px + w / 2 >= m.w - 1 ||
        tanks.some(t => Math.abs(t.x - px) < w / 2 + t.half_width + 18)) continue;
      const x0 = Math.floor((px - w / 2) * 2), x1 = Math.ceil((px + w / 2) * 2);
      let floor = -1;
      const start = Math.ceil(m.surface[px * 2] * 2) + 16;
      for (let y = start; y < m.fh; y++) {
        const i = px * 2 * m.fh + y;
        if (m.cells[i] > 0 && m.cells[i] < 4 && !m.cells[i - 1] &&
          (y > h * 2 && !m.cells[i - Math.ceil(h * 2)])) { floor = y / 2; break; }
      }
      if (floor < h + 40 || floor >= m.h - 2) continue;
      if (m.props.some(p => Math.abs(p.x - px) < (p.w + w) / 2 + 1 &&
        floor > p.y - p.h - h && floor < p.y + h)) continue;
      // Require a flat ledge so stones cannot obstruct the chamber mouth.
      const reach = h;
      let high = m.h, low = 0, supported = true;
      for (let x = x0; x < x1; x++) {
        let y = Math.max(1, Math.floor((floor - reach) * 2));
        const limit = Math.min(m.fh - 1, Math.ceil((floor + reach) * 2));
        while (y < limit && !m.cells[x * m.fh + y]) y++;
        if (y === limit || m.cells[x * m.fh + y] >= 16) { supported = false; break; }
        high = Math.min(high, y / 2); low = Math.max(low, y / 2);
      }
      if (!supported || low - high > h * .65) continue;
      const y = Math.min(m.h - 1, low + Math.min(2, h * .25));
      const p: Prop = { id: m.props.length + 16, kind: "rock", x: px, y, w, h, variant: rnd };
      const y0 = Math.floor((y - h) * 2), y1 = Math.ceil(y * 2);
      // Keep the whole footprint beneath the ridge, including mouth edges.
      if (m.surface.subarray(x0, x1).some(top => top * 2 >= y0)) continue;
      let stamped = false;
      for (let x = x0; x < x1; x++) for (let yy = y0; yy < y1; yy++) {
        const i = x * m.fh + yy;
        // Embedded stone replaces the soil inside its silhouette, so turf
        // cannot paint across the boulder face. Existing props stay intact.
        if (m.cells[i] < 4 && rockContains(((x + .5) / 2 - px) / w, (y - (yy + .5) / 2) / h, rnd)) {
          m.cells[i] = p.id; stamped = true;
        }
      }
      if (stamped) { m.props.push(p); m.publish(x0, y0, x1, y1); }
    }
  }
}

export function alpineRockColor(u: number, v: number, variant: number, grain: number, snow: boolean): [number, number, number] {
  const top = rockTop(u, variant);
  const facet = v > top - .2 ? 32 : u > .60 + v * .16 ? -28 : 0;
  let light = facet + (grain - .5) * 19 + variant * 16;
  if (Math.abs(v - (.27 + u * .24)) < .018 || u > .39 && u < .42 && v < .55) light -= 30;
  if (snow && v > top - .10 - grain * .04) return [219 + grain * 24, 231 + grain * 19, 236 + grain * 18];
  return [108 + light, 119 + light, 124 + light];
}
