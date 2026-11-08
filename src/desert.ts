/** Browser-only sandstone geology. Dimensions are relative to the map; the
 * material shader uses fixed world coordinates so damage/save reloads agree. */
import { hash } from "./modern";

function noise(x: number, seed: number): number {
  const a = Math.floor(x), t = x - a, s = t * t * (3 - 2 * t);
  return hash(a, 0, seed) * (1 - s) + hash(a + 1, 0, seed) * s;
}

export function desertMesas(seed: number) {
  const count = 2 + Math.floor(hash(0, 201, seed) * 2);
  const rotation = Math.floor(hash(0, 208, seed) * count);
  return Array.from({ length: count }, (_, i) => ({
    center: (i + .38 + hash(i, 202, seed) * .24) / count,
    radius: (.35 + hash(i, 203, seed) * .12) / count,
    // Stratified heights ensure a visible contrast even when random draws agree.
    rise: .40 + ((i + rotation) % count) / (count - 1) * .53 + hash(i, 204, seed) * .07,
    lean: (hash(i, 205, seed) - .5) * .38,
    cap: .30 + hash(i, 209, seed) * .18,
    leftWall: .09 + hash(i, 210, seed) * .10,
    rightWall: .18 + hash(i, 211, seed) * .16,
    ledge: .25 + hash(i, 212, seed) * .13,
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
      // Small rock shelves break the walls; caps remain broad enough for tanks.
      const erosion = (noise(u * 95, seed + i + 220) - .5) * .018;
      const d = distance + erosion * Math.min(1, distance / mesa.cap);
      const shoulder = mesa.cap + wall;
      let shape: number;
      if (d < mesa.cap) shape = 1;
      else if (d < shoulder) {
        const t = (d - mesa.cap) / wall;
        shape = 1 - (1 - mesa.ledge) * (t * .80 + Math.floor(t * 4) / 4 * .20);
      } else if (d < shoulder + .07) shape = mesa.ledge - (d - shoulder) * .35;
      else shape = Math.max(0, (mesa.ledge - .0245) * (1 - d) / (1 - shoulder - .07));
      uplift = Math.max(uplift, shape * mesa.rise);
    }
    const value = 1 - uplift + (noise(u * 17, seed + 206) - .5) * .025 +
      (noise(u * 63, seed + 207) - .5) * .005;
    heights[x] = value; lo = Math.min(lo, value); hi = Math.max(hi, value);
  }
  const range = Math.max(1e-9, hi - lo);
  for (let x = 0; x < width; x++) heights[x] = (heights[x] - lo) / range;
  return heights;
}

/** Warm sedimentary beds, fractured vertical faces and fine erosion. Keep the
 * generic soil photograph subtle: sandstone should read as long strata and
 * columns, rather than the same chunky texture pasted across every cliff. */
export function sandstoneColor(x: number, y: number, seed: number, grain: number, texture: number): [number, number, number] {
  const bedY = y + Math.sin(x * .012) * 4 + noise(x / 75, seed + 701) * 14 +
    noise(x / 19, seed + 708) * 2 + noise(y / 95, seed + 709) * 16;
  const bed = Math.floor(bedY / 31), within = bedY / 31 - bed;
  const layer = noise(bedY / 43, seed + 702);
  const meander = Math.sin(y * .017 + noise(x / 90, seed) * 3) * 2;
  const u = (x + meander) / 26;
  const row = Math.floor(y / 105), fraction = y / 105 - row;
  const blend = fraction * fraction * (3 - 2 * fraction);
  const face = (offset: number) => noise(u + offset, seed + 703 + row * 53) * (1 - blend) +
    noise(u + offset, seed + 703 + (row + 1) * 53) * blend;
  const flute = face(0), broad = noise(x / 85 + noise(y / 140, seed + 712) * .3, seed + 704);
  const facet = Math.floor(flute * 5) / 5;
  const lighting = (face(.13) - face(-.13)) * 105;
  let light = (facet - .45) * 47 + (broad - .5) * 32 + lighting + texture * .40 + (grain - .5) * 6;
  // Narrow bedding seams with a sunlit lower lip, broken by weathering.
  if (hash(bed, 710, seed) > .63) {
    if (within < .035 && flute > .32) light -= 15;
    else if (within < .08) light += 8;
  }
  const joint = (x + meander + noise(y / 95, seed + 711) * 8) / 39;
  if (joint - Math.floor(joint) < .025 && hash(Math.floor(joint), Math.floor(y / 113), seed) > .55) light -= 24;
  const fine = Math.sin(bedY * 1.5 + flute * 4) * 2;
  return [173 + layer * 31 + light + fine, 85 + layer * 34 + light * .82 + fine,
    52 + layer * 25 + light * .66 + fine];
}
