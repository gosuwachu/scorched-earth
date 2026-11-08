/** Browser-only sandstone geology. Dimensions are relative to the map; the
 * material shader uses fixed world coordinates so damage/save reloads agree. */
import { hash } from "./modern";
import { rockRelief } from "./terrain_depth";

function noise(x: number, seed: number): number {
  const a = Math.floor(x), t = x - a, s = t * t * (3 - 2 * t);
  return hash(a, 0, seed) * (1 - s) + hash(a + 1, 0, seed) * s;
}

export function desertMesas(seed: number) {
  const count = 2 + Math.floor(hash(0, 201, seed) * 2);
  const rotation = Math.floor(hash(0, 208, seed) * count);
  return Array.from({ length: count }, (_, i) => ({
    center: (i + .38 + hash(i, 202, seed) * .24) / count,
    radius: (.43 + hash(i, 203, seed) * .08) / count,
    // Stratified heights ensure a visible contrast even when random draws agree.
    rise: .40 + ((i + rotation) % count) / (count - 1) * .53 + hash(i, 204, seed) * .07,
    lean: (hash(i, 205, seed) - .5) * .38,
    cap: .26 + hash(i, 209, seed) * .12,
    leftWall: .12 + hash(i, 210, seed) * .09,
    rightWall: .25 + hash(i, 211, seed) * .10,
    ledge: .42 + hash(i, 212, seed) * .15,
  }));
}

export function desertProfile(width: number, seed: number): Float64Array {
  const heights = new Float64Array(width), mesas = desertMesas(seed);
  let lo = Infinity, hi = -Infinity;
  for (let x = 0; x < width; x++) {
    const u = x / width;
    let uplift = 0;
    for (const [i, mesa] of mesas.entries()) {
      const side = u < mesa.center ? -1 : 1;
      const distance = Math.abs(u - mesa.center) / (mesa.radius * (1 + side * mesa.lean));
      const wall = side < 0 ? mesa.leftWall : mesa.rightWall;
      const shoulder = mesa.cap + wall;
      // Erosion cuts small, uneven notches into cliff faces without disturbing
      // the broad caps. Each side has independent weathering and terrace widths.
      const erosion = (noise(u * 125, seed + i * 13 + (side < 0 ? 220 : 241)) - .5) * .022;
      const d = distance + erosion * Math.min(1, distance / mesa.cap);
      let shape: number;
      if (d < mesa.cap) shape = 1;
      else if (d < shoulder) {
        const t = (d - mesa.cap) / wall;
        const tiers = side < 0 ? 3 : 4;
        const tier = Math.min(tiers - 1, Math.floor(t * tiers));
        const local = t * tiers - tier;
        const shelf = .17 + hash(i * 11 + tier, side + 230, seed) * .16;
        const descent = Math.max(0, (local - shelf) / (1 - shelf));
        // Nearly level sandstone ledges alternate with steep eroded risers.
        const stepped = (tier + descent) / tiers;
        shape = 1 - (1 - mesa.ledge) * (t * .12 + stepped * .88);
      } else if (d < shoulder + .10) shape = mesa.ledge - (d - shoulder) * .15;
      else {
        const t = Math.max(0, (1 - d) / (1 - shoulder - .10));
        const terrace = Math.floor(t * 3) / 3;
        const within = t * 3 - Math.floor(t * 3);
        const rise = Math.min(1, within / .64) / 3;
        // Wide talus aprons and secondary benches give the cliff a substantial
        // base rather than extending a straight wall almost to the valley floor.
        shape = (mesa.ledge - .015) * (t * .65 + (terrace + rise) * .35);
      }
      uplift = Math.max(uplift, shape * mesa.rise);
    }
    const value = 1 - uplift + (noise(u * 17, seed + 206) - .5) * .018 +
      (noise(u * 63, seed + 207) - .5) * .004;
    heights[x] = value; lo = Math.min(lo, value); hi = Math.max(hi, value);
  }
  const range = Math.max(1e-9, hi - lo);
  for (let x = 0; x < width; x++) heights[x] = (heights[x] - lo) / range;
  return heights;
}

/** World-anchored sandstone slabs. Bedding colour and broad relief carry the
 * form; the source photograph supplies only fine mineral variation. */
export function sandstoneColor(x: number, y: number, seed: number, grain: number, texture: number,
  relief = rockRelief(x, y, seed)): [number, number, number] {
  const bed = hash(relief.bed, 702, seed);
  const pale = bed > .70 ? 1 : 0;
  const striae = Math.sin((y + Math.sin(x * .021) * 6) * .72) * 2;
  const light = relief.light + texture * .42 + striae + (grain - .5) * 5;
  return [181 + bed * 26 + pale * 12 + light,
    88 + bed * 25 + pale * 29 + light * .82,
    49 + bed * 18 + pale * 18 + light * .59];
}

export const DESERT_MATERIALS = ["desert-sand", "desert-cliff", "desert-beds", "desert-deep-v2"] as const;
