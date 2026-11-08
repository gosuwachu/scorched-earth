import { CaveLayers } from "./cave_layers";
import { hash, type ModernWorld } from "./modern";

export const SWAMP_SCENERY = [
  "plant-0", "plant-1", "plant-2", "plant-3",
  "root-0", "root-1", "root-2", "root-3",
  "stalactite-0", "stalactite-1", "stalactite-2", "stalactite-3",
  "moss-0", "moss-1", "moss-2", "moss-3",
] as const;
export type SwampSceneryName = typeof SWAMP_SCENERY[number];
export type SwampScenery = {
  kind: "plant" | "root" | "stalactite" | "moss";
  name: SwampSceneryName;
  variant: number;
  x: number;
  /** Ground contact for plants/roots; embedding seam for stalactites. */
  y: number;
  w: number;
  h: number;
  flip: boolean;
  ceilingLayer?: "front" | "middle";
};

function material(world: ModernWorld, x: number, y: number): number {
  const ix = Math.floor(x * 2), iy = Math.floor(y * 2);
  return ix < 0 || ix >= world.fw || iy < 0 || iy >= world.fh ? -1 : world.cells[ix * world.fh + iy];
}

function ground(world: ModernWorld, layers: CaveLayers, x: number): number {
  if (world.layout === "CAVE") {
    // Generated anchors survive save/load and are not transplanted onto fresh
    // crater floors. Allow only the rounding of the half-unit collision grid.
    return Math.floor(layers.column(x).surface * 2) / 2;
  }
  // Mountain swamp saves contain their current mask, not a generation profile.
  for (let y = 1; y < world.h; y += .5)
    if (material(world, x, y) === 1 && material(world, x, y - .5) === 0) return y;
  return world.h;
}

/** Sparse, seeded slots leave most of the terrain unadorned. Rejected slots
 * remain empty; digging never causes an expanding search to fill new sites. */
export function swampScenery(world: ModernWorld,
  layers = new CaveLayers(world.w, world.h, world.seed)): SwampScenery[] {
  if (world.biome !== "SWAMP" || world.layout === "CITY") return [];
  const result: SwampScenery[] = [];
  const scale = Math.min(1, world.w / 640);
  for (const [group, kind] of (["plant", "root", "stalactite", "moss"] as const).entries()) {
    const ceiling = kind === "stalactite" || kind === "moss";
    if (ceiling && world.layout !== "CAVE") continue;
    const maximum = kind === "plant" ? 8 : kind === "stalactite" ? 5 : 3;
    const spacing = kind === "plant" ? 135 : kind === "stalactite" ? 205 : 340;
    const count = Math.min(maximum, Math.max(1, Math.round(world.w / spacing)));
    const salt = 1500 + group * 30;
    const rotation = Math.floor(hash(world.seed, salt) * 4);
    const position = (slot: number): number => world.w * (slot + .24 + hash(slot, salt + 3, world.seed) * .52) / count;
    // Choose large plants from original, usable banks, not the current live
    // mask. Props are saved/stable; destroying a plant cannot promote another.
    const largeSlots = new Set(kind === "plant" && count >= 4 ? Array.from({ length: count }, (_, slot) => slot)
      .filter(slot => {
        const x = position(slot), width = 112 * scale, height = 117 * scale;
        if (x - width / 2 < 2 || x + width / 2 >= world.w - 2) return false;
        if (world.layout !== "CAVE") return true;
        const c = layers.column(x);
        return Math.abs(layers.column(x - 2).surface - layers.column(x + 2).surface) <= 3 &&
          c.surface - height > Math.max(36, c.roof + 4) &&
          !world.props.some(q => Math.abs(q.x - x) < (q.w + width) / 2 + 9 &&
            q.y > c.surface - height - 3 && q.y - q.h < c.surface + 4);
      })
      .sort((a, b) => hash(a, salt + 8, world.seed) - hash(b, salt + 8, world.seed))
      .slice(0, count >= 6 ? 2 : 1) : []);
    for (let slot = 0; slot < count; slot++) {
      const variant = (slot + rotation) % 4;
      const size = hash(slot, salt + 1, world.seed);
      const tall = largeSlots.has(slot);
      const heightVariation = hash(slot, salt + 2, world.seed);
      const w = (kind === "plant" ? tall ? 82 + size * 30 : 28 + size * 35 :
        kind === "root" ? 30 + size * 25 : kind === "moss" ? 48 + size * 40 : (48 + size * 42) * 1.75) * scale;
      const h = (kind === "plant" ? tall ? 85 + heightVariation * 32 : 22 + heightVariation * 34 :
        kind === "root" ? 32 + heightVariation * 23 : kind === "moss" ? 62 + heightVariation * 58 :
        (65 + heightVariation * 70) * 1.75) * scale;
      // One jittered position per region: no regular row of identical clumps.
      const x = position(slot);
      if (x - w / 2 < 2 || x + w / 2 >= world.w - 2) continue;
      const ceilingLayer = slot % 2 ? "middle" : "front";
      const c = layers.column(x);
      const y = ceiling ? (ceilingLayer === "front" ? c.frontRoof : c.middleRoof) : ground(world, layers, x);
      const p: SwampScenery = { kind, variant, name: `${kind}-${variant}` as SwampSceneryName,
        x, y, w, h, flip: hash(slot, salt + 4, world.seed) > .5,
        ...(ceiling ? { ceilingLayer } : {}),
      };
      if (ceiling) {
        // A broad base must still have living ceiling rock above its seam.
        // Excavated supports remove the whole decorative cluster.
        if ([-.2, 0, .2].some(t => {
          const sx = x + w * t, sc = layers.column(sx);
          const seam = ceilingLayer === "front" ? sc.frontRoof : Math.max(sc.frontRoof, sc.middleRoof);
          return material(world, sx, seam - 3) !== 2 || material(world, sx, seam - 1) !== 2;
        }) || y + h > c.surface - 12) continue;
      } else {
        if (y >= world.h - 8 || material(world, x, y + 1) !== 1 || material(world, x, y - .5) !== 0) continue;
        const feet = [-1, 0, 1].map(offset => ground(world, layers, x + offset * 2));
        if (Math.max(...feet) - Math.min(...feet) > 3 || feet.some((sy, i) => material(world, x + (i - 1) * 2, sy + 1) !== 1)) continue;
        if (kind === "plant" && (y - h < 36 ||
          [-.3, 0, .3].some(t => material(world, x + w * t, y - h * .5) !== 0))) continue;
        if (kind === "root" && material(world, x, y + Math.min(12, h * .3)) !== 1) continue;
        if (world.props.some(q => Math.abs(q.x - x) < (q.w + w) / 2 + 9 &&
          q.y > y - h - 3 && q.y - q.h < y + 4)) continue;
      }
      result.push(p);
    }
  }
  // Recessed ceiling sprites go down first; foreground bases can overlap them.
  return result.sort((a, b) => Number(a.ceilingLayer === "front") - Number(b.ceilingLayer === "front"));
}

/** Painted sprites share the cached terrain's blast mask. A small reusable
 * canvas clips roots to soil and tucks stalactite bases behind ceiling sheets. */
export function drawSwampVegetation(ctx: CanvasRenderingContext2D, world: ModernWorld,
  image: (name: SwampSceneryName) => HTMLImageElement, layers: CaveLayers): void {
  let scratch: HTMLCanvasElement | undefined;
  ctx.save(); ctx.scale(2, 2);
  for (const p of swampScenery(world, layers)) {
    const sprite = image(p.name);
    if (!sprite.complete || !sprite.naturalWidth || !sprite.naturalHeight) continue;
    // Trimmed variants keep their own proportions; the seeded box controls the
    // maximum size without making a wide root look like a tall reed.
    const fit = Math.min(p.w / sprite.naturalWidth, p.h / sprite.naturalHeight);
    const w = sprite.naturalWidth * fit, h = sprite.naturalHeight * fit;
    const left = p.x - w / 2;
    const top = p.kind === "plant" ? p.y - h + Math.max(2, h * .1) : p.kind === "root" ? p.y - 1 : p.y - h * (p.kind === "moss" ? .1 : .18);
    const x0 = Math.floor(left * 2), y0 = Math.floor(top * 2);
    scratch ??= document.createElement("canvas");
    scratch.width = Math.ceil(w * 2) + 2; scratch.height = Math.ceil(h * 2) + 2;
    const sctx = scratch.getContext("2d", { willReadFrequently: true })!;
    sctx.save();
    if (p.kind === "stalactite") sctx.filter = `brightness(${p.ceilingLayer === "middle" ? .78 : .96})`;
    else if (p.kind === "moss" && p.ceilingLayer === "middle") sctx.filter = "brightness(.93)";
    sctx.translate((p.flip ? left + w : left) * 2 - x0, top * 2 - y0);
    sctx.scale(p.flip ? -1 : 1, 1);
    sctx.drawImage(sprite, 0, 0, w * 2, h * 2); sctx.restore();
    const pixels = sctx.getImageData(0, 0, scratch.width, scratch.height);
    for (let xx = 0; xx < scratch.width; xx++) {
      const x = (x0 + xx) / 2, column = layers.column(x);
      const seam = p.ceilingLayer === "front" ? column.frontRoof : Math.max(column.frontRoof, column.middleRoof);
      for (let yy = 0; yy < scratch.height; yy++) {
        const y = (y0 + yy) / 2, at = (yy * scratch.width + xx) * 4 + 3;
        if (!pixels.data[at]) continue;
        const m = material(world, x, y);
        if (p.kind === "root") {
          if (m !== 1) pixels.data[at] = 0;
        } else if (p.kind === "plant") {
          if (m !== 0) pixels.data[at] = 0;
        } else {
          // The sheet above the seam occludes the broad top. The first two
          // pixels blend into its existing contact shadow without a sticker edge.
          if (y < seam || y >= column.surface - 4 || m < 0 || m >= 16 || m === 1 || m === 3) pixels.data[at] = 0;
          else pixels.data[at] *= Math.min(1, (y - seam) / 1.5);
        }
      }
    }
    sctx.putImageData(pixels, 0, 0);
    ctx.drawImage(scratch, x0 / 2, y0 / 2, scratch.width / 2, scratch.height / 2);
  }
  ctx.restore();
}
