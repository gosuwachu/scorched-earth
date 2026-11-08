import type { CaveColumn } from "./cave_layers";
import { fullFrameMaterial, paintedMaterial, type MaterialPixels } from "./terrain_material";

export const SWAMP_MATERIALS = ["swamp-ground-v2", "swamp-turf"] as const;
export const CAVE_MATERIALS = ["ground", "topsoil", "ceiling", "stalactite"] as const;
type RGB = [number, number, number];

/** Repeat a generated material strip horizontally, blending only its overlapping ends.
 * Overlapping ends soften seams without stretching painted stone fragments. */
export function caveStrip(image: MaterialPixels, x: number, v: number,
  crop: readonly [number, number, number, number]): RGB {
  const [left, top, width, height] = crop;
  const overlap = Math.min(32, Math.floor(width / 5)), period = width - overlap;
  const sx = ((Math.floor(x) % period) + period) % period;
  const sy = top + Math.max(0, Math.min(height - 1, Math.floor(v * height)));
  const mix = sx < overlap ? 1 - sx / overlap : 0;
  const at = (sy * image.width + left + sx) * 4;
  const other = mix ? at + period * 4 : at;
  return [0, 1, 2].map(k => image.data[at + k] * (1 - mix) + image.data[other + k] * mix) as RGB;
}

/** Current mask, not the unsaved generation profile, owns the layer anchors. */
export function caveColumns(cells: Uint8Array, width: number, height: number): { roof: Uint16Array; soil: Uint16Array } {
  const roof = new Uint16Array(width), soil = new Uint16Array(width);
  for (let x = 0; x < width; x++) {
    const start = x * height;
    let y = 0;
    while (y < height && cells[start + y] === 2) y++;
    roof[x] = y;
    while (y < height && cells[start + y] !== 1) y++;
    soil[x] = y;
  }
  return { roof, soil };
}

export function caveMaterial(images: readonly (MaterialPixels | undefined)[], x: number, y: number,
  roof: number, soil: number, height: number, material: number, cave: boolean, layers?: CaveColumn, width = height * 4 / 3): RGB {
  if (layers) {
    const sample = (index: number, fallback: RGB): RGB => {
      const source = images[index];
      if (!source) return fallback;
      // Texture coordinates stay flat; only sheet boundaries bend. Never
      // stretch a painting to the height of a cliff or stalactite.
      const scale = index === 1 ? 1.25 : .9;
      return paintedMaterial(source, x * scale, y * scale, 0);
    };
    const py = y / 2;
    const shadow = (edge: number, reach: number, strength: number): number =>
      py >= edge ? strength * Math.exp(-(py - edge) / reach) : 0;
    let color: RGB, light = 1;
    if (cave && (py < layers.roof || y < roof)) {
      if (py < layers.frontRoof) {
        color = sample(2, [157, 151, 131]);
        light = .95 + Math.max(0, 1 - (layers.frontRoof - py) / 3) * .13;
      } else if (py < layers.middleRoof) {
        color = sample(3, [119, 121, 109]);
        light = .78 - shadow(layers.frontRoof, 12, .5);
        light += Math.max(0, 1 - (layers.middleRoof - py) / 3) * .1;
      } else {
        color = sample(3, [100, 112, 105]);
        light = .56 - shadow(layers.middleRoof, 15, .32);
      }
    } else {
      // Ground beds differ by their painted material, not by cast shadows or
      // highlighted lips. Keep illumination continuous across their boundaries.
      light = .9;
      if (images[4]) {
        // The new ground is one complete painting across the world, just like
        // desert deep rock. No repeat, seed offset or per-column stretching.
        color = fullFrameMaterial(images[4], x, y, width, height);
      } else if (py < layers.stoneTop || material === 3) {
        color = sample(1, [95, 69, 43]);
      } else if (py < layers.stoneBottom) {
        color = sample(2, [139, 132, 111]);
      } else {
        color = sample(1, [95, 69, 43]);
      }
    }
    return color.map(c => c * Math.max(.16, light)) as RGB;
  }
  if (cave && y < roof) {
    const ceiling = images[2];
    let color: RGB = ceiling ? caveStrip(ceiling, x * .65, (y * .8 % ceiling.height) / ceiling.height, [0, 0, ceiling.width, ceiling.height]) : [157, 151, 131];
    // Only the projecting points receive the cooler shaded stalactite material.
    // Both materials contain solid rock only, without baked-in silhouettes.
    const tip = images[3], blend = Math.max(0, Math.min(1, (roof - height * .17) / 65)) *
      Math.max(0, Math.min(1, (y / Math.max(1, roof) - .52) / .3));
    if (tip && blend > 0) {
      const stone = caveStrip(tip, x * .7, (y * .8 % tip.height) / tip.height, [0, 0, tip.width, tip.height]);
      color = color.map((c, k) => c * (1 - blend) + stone[k] * blend) as RGB;
    }
    return color;
  }
  if (material === 1 || material === 3) {
    const topsoil = images[1];
    return topsoil ? caveStrip(topsoil, x * .7, (y * .8 % topsoil.height) / topsoil.height, [0, 0, topsoil.width, topsoil.height]) : [95, 69, 43];
  }
  const ground = images[0];
  // Broad, gently undulating geological beds; no diagonal granite repetition.
  const phase = (y * .6 + Math.sin(x * .004) * 12) / 128;
  return ground ? caveStrip(ground, x * .65, phase - Math.floor(phase), [0, 0, ground.width, ground.height]) : [77, 69, 53];
}
