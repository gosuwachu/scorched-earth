import { hash, type ModernWorld } from "./modern";
import { DesertLayers } from "./desert_layers";

export const DESERT_SCENERY = ["shrub", "rock", "adobe", "truck"] as const;
export type DesertSceneryKind = typeof DESERT_SCENERY[number];
export type DesertScenery = { kind: DesertSceneryKind; x: number; y: number; w: number; h: number };
const aspects = [693 / 325, 700 / 235, 655 / 351, 736 / 311];

/** Roots occupy an area of the visible sand plane, including its interior.
 * Neither a silhouette edge nor empty sky above the root is required. */
export function desertScenerySupported(world: ModernWorld, layers: DesertLayers, p: DesertScenery, live = true): boolean {
  const contact = p.w * (p.kind === "shrub" ? .12 : .48);
  for (let x = Math.floor((p.x - contact) * 2); x <= Math.ceil((p.x + contact) * 2); x++) {
    for (let y = Math.floor((p.y - 1) * 2); y <= Math.ceil((p.y + 1.5) * 2); y++) {
      if (x < 0 || x >= world.fw || y < 0 || y >= world.fh ||
        (live && world.cells[x * world.fh + y] !== 1) || !layers.sandContains(x / 2, y / 2)) return false;
    }
  }
  return true;
}

/** Seeded candidates stay at their original depth on the sand plane. Removing
 * support hides a candidate; it does not transplant it onto a crater floor. */
export function desertScenery(world: ModernWorld, layers = new DesertLayers(world.w, world.h, world.seed)): DesertScenery[] {
  if (world.biome !== "DESERT" || world.layout !== "MOUNTAINS") return [];
  const result: DesertScenery[] = [];
  // Buildings/vehicles choose open sand first, then the aprons below cliffs.
  for (const pass of [2, 3, 0]) {
    const candidates: DesertScenery[] = [];
    for (let n = 0, x = 20; x < world.w - 20; n++, x += 27) {
      if (!pass && hash(n, 1205, world.seed) < .28) continue;
      const kindIndex = pass || (hash(n, 1201, world.seed) > .72 ? 1 : 0);
      const kind = DESERT_SCENERY[kindIndex];
      const w = (kindIndex < 2 ? 13 : kindIndex === 2 ? 45 : 38) + hash(n, 1202, world.seed) * 15;
      const h = w / aspects[kindIndex], px = x + hash(n, 1203, world.seed) * 9;
      const column = layers.column(px);
      const back = column.cliffTop < column.sandBack ? column.cliffFoot : column.sandBack;
      const y = back + (column.sandFront - back) * (.24 + hash(n, 1204 + pass, world.seed) * .5);
      candidates.push({ kind, x: px, y, w, h });
    }
    if (pass) candidates.sort((a, b) => {
      const rise = (p: DesertScenery) => Math.max(0, layers.column(p.x).sandBack - layers.column(p.x).cliffTop);
      return rise(a) - rise(b);
    });
    for (const p of candidates) {
      if (p.x - p.w / 2 < 0 || p.x + p.w / 2 >= world.w || p.y - p.h < 40) continue;
      // Overlapping screen footprints matter; an unrelated rock on a high
      // cliff should not exclude a plant on the sand apron far below it.
      const overlaps = (q: { x: number; y: number; w: number; h: number }) =>
        Math.abs(q.x - p.x) < (q.w + p.w) / 2 + 3 && q.y > p.y - p.h - 2 && q.y - q.h < p.y + 2;
      if (result.some(overlaps) || world.props.some(overlaps) || !desertScenerySupported(world, layers, p, false)) continue;
      result.push(p);
      if (pass) break;
    }
  }
  return result.filter(p => desertScenerySupported(world, layers, p)).sort((a, b) => a.y - b.y);
}

/** Last terrain pass, sharing the terrain's blast mask. Objects can cover sand
 * and cliff artwork while their roots still sit wholly on exposed sand. */
export function drawDesertScenery(ctx: CanvasRenderingContext2D, world: ModernWorld,
  image: (kind: DesertSceneryKind) => HTMLImageElement, layers: DesertLayers): void {
  ctx.save(); ctx.scale(2, 2);
  for (const p of desertScenery(world, layers)) {
    const sprite = image(p.kind);
    if (!sprite.complete || !sprite.naturalWidth) continue;
    ctx.fillStyle = "rgba(91,46,22,.23)";
    ctx.beginPath(); ctx.ellipse(p.x + p.w * .06, p.y + .4, p.w * .36, Math.max(1, p.w * .035), 0, 0, Math.PI * 2); ctx.fill();
    ctx.drawImage(sprite, p.x - p.w / 2, p.y - p.h, p.w, p.h);
  }
  ctx.restore();
}
