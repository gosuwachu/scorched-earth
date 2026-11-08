import { hash } from "./modern";

export type CaveColumn = {
  surface: number;
  earthShelf: number;
  stoneTop: number;
  stoneBottom: number;
  frontRoof: number;
  middleRoof: number;
  roof: number;
};
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Thickness of the living turf sheet, in logical world units. Broad moss
 * cushions alternate with thin grass instead of outlining every bank equally.
 * Coordinates, not traversal order or mutable RNG, own the patch positions. */
export function swampGrassDepth(x: number, worldHeight: number, seed: number): number {
  const scale = worldHeight / 768;
  const position = x / scale;
  const region = Math.floor(position / 192), u = position / 192 - region;
  const center = .34 + hash(region, 830, seed) * .32;
  const radius = .24 + hash(region, 831, seed) * .09;
  const cushion = smooth(0, 1, 1 - Math.abs(u - center) / radius);
  const grain = position / 29, grainCell = Math.floor(grain);
  const t = smooth(0, 1, grain - grainCell);
  const fine = hash(grainCell, 832, seed) * (1 - t) + hash(grainCell + 1, 832, seed) * t;
  return scale * (4.5 + fine * 1.8 + cushion * (21 + hash(region, 833, seed) * 6));
}

/** Overlapping earth banks and ceiling shelves, inspired by the swamp concept.
 * Like the desert's layer stack, each sheet has its own edge. World anchoring
 * keeps textures and baked contact shadows fixed during excavation/save replay. */
export class CaveLayers {
  readonly columns: CaveColumn[];
  constructor(readonly width: number, readonly height: number, seed: number) {
    const noise = (x: number, salt: number): number => {
      const i = Math.floor(x), t = smooth(0, 1, x - i);
      return hash(i, salt, seed) * (1 - t) + hash(i + 1, salt, seed) * t;
    };
    this.columns = Array.from({ length: width * 2 }, (_, x) => {
      const u = x / (width * 2);
      const banks = .135 * (1 - smooth(.15, .24, u)) + .115 * smooth(.78, .87, u);
      // Two broad, seeded summits divide the chamber into hills and valleys.
      // Smaller hummocks roughen their shoulders while leaving firing headroom.
      let mountains = 0;
      for (let peak = 0; peak < 2; peak++) {
        const center = .28 + peak * .38 + (hash(peak, 817, seed) - .5) * .10;
        const radius = .14 + hash(peak, 818, seed) * .05;
        mountains += smooth(0, 1, 1 - Math.abs(u - center) / radius) *
          (.20 + hash(peak, 819, seed) * .045);
      }
      const surface = height * (.707 - banks - mountains + (noise(u * 11, 805) - .5) * .09 +
        (noise(u * 29, 806) - .5) * .03 + (noise(u * 71, 816) - .5) * .007);
      const earthShelf = surface + height * (.09 + noise(u * 12, 807) * .022);
      const stoneTop = height * (.87 + (noise(u * 8, 808) - .5) * .035) - banks * height * .24;
      const stoneBottom = stoneTop + height * (.043 + noise(u * 16, 809) * .015);
      const sides = .065 * (Math.exp(-u * 16) + Math.exp(-(1 - u) * 16));
      const frontBase = height * (.085 + sides + noise(u * 12, 810) * .025 + (noise(u * 97, 813) - .5) * .006);
      const middleBase = height * (.13 + sides + noise(u * 10 + .4, 811) * .03 + (noise(u * 81, 814) - .5) * .008);
      const rearBase = height * (.18 + sides + noise(u * 9, 812) * .028 + (noise(u * 113, 815) - .5) * .007);
      // Painted stalactite variants supply the hanging details. The shelves
      // themselves remain broad rock sheets with gently fractured edges.
      const frontRoof = frontBase, middleRoof = middleBase;
      const roof = Math.max(frontRoof, middleRoof, rearBase);
      return { surface, earthShelf, stoneTop, stoneBottom, frontRoof, middleRoof, roof };
    });
  }
  column(x: number): CaveColumn {
    return this.columns[Math.max(0, Math.min(this.columns.length - 1, Math.floor(x * 2)))];
  }
}
