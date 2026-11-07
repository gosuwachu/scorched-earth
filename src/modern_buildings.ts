/** Fine-cell facade artwork for the destructible city blocks. The collision
 * silhouette lives in modern.ts; these colours never change its geometry. */
import { hash, type Prop } from "./modern";
import { landmarkColor } from "./landmark_art";

export function buildingColor(p: Prop, x: number, y: number, seed: number): [number, number, number] {
  const landmark = landmarkColor(p, x, y, seed);
  if (landmark) return landmark;
  const dx = x - p.x + p.w / 2, dy = p.y - y, top = p.h - dy;
  const side = dx > p.w * .84, edge = dx < 1.5 || dx > p.w - 1.5;
  const grain = (hash(Math.floor(x * 2), Math.floor(y * 2), seed) - .5) * 12;
  const light = grain + (side ? -25 : 8) - dx / p.w * 10;
  const tint = (r: number, g: number, b: number): [number, number, number] => [r + light, g + light, b + light];
  const trim = () => tint(152, 159, 158);
  // Sunlit parapets, cornices and a dark plinth anchor every facade.
  if (top < 1.5 || p.kind === "office" && Math.abs(dy - p.h * .88) < 1.2) return tint(199, 202, 188);
  if (top < 4 || dy < 3 || edge) return tint(72, 83, 91);
  if (p.kind === "warehouse") {
    if (top < 10) return tint(97, 119, 119);
    const bay = dx % 22;
    if (dy < p.h * .62 && bay > 3 && bay < 20) {
      if (dy % 4 < .8) return tint(55, 69, 73);
      return tint(121, 137, 139); // corrugated loading doors
    }
    if (dy > p.h * .7 && dy < p.h * .85 && dx % 9 > 2) return tint(90, 153, 165);
    return dx % 6 < .7 ? tint(93, 98, 89) : tint(153, 147, 124);
  }
  if (p.kind === "shop") {
    const awningY = Math.min(p.h * .55, 25);
    if (dy > awningY && dy < awningY + 5) return Math.floor(dx / 4) % 2 ? tint(207, 192, 150) : tint(40, 112, 116);
    if (dy > awningY + 8 && dy < awningY + 15 && dx > 6 && dx < p.w - 6) {
      // Small illuminated sign panels, with restrained stencil-like marks.
      return dx % 5 < 2 && dy % 5 < 3 ? tint(240, 210, 134) : tint(34, 62, 71);
    }
    if (dy < awningY && dx > 4 && dx < p.w - 4) {
      if (dx % 16 < 1.5 || dy < 5) return trim();
      return tint(68 + dy * .5, 116 + dy * .4, 131 + dy * .3);
    }
    return tint(177, 144, 105);
  }
  const floor = p.kind === "office" ? 13 : 17;
  const colWidth = p.kind === "office" ? 8 : 12;
  const row = Math.floor(dy / floor), col = Math.floor(dx / colWidth);
  const wx = dx % colWidth, wy = dy % floor;
  if (dy < 13 && Math.abs(dx - p.w * .5) < 7) {
    return Math.abs(dx - p.w * .5) < .8 || dy < 4 ? trim() : tint(48, 78, 90);
  }
  if (p.kind === "office") {
    if (wy < 1 || wx < .8) return trim();
    if (hash(col, row, seed + p.id) > .73) return tint(217, 183, 113);
    const reflection = Math.sin(dx / p.w * 8 + dy * .012) * 16;
    return tint(47 + reflection, 103 + reflection + dy * .09, 133 + reflection + dy * .09);
  }
  // Brick apartments: inset windows, lintels, balconies and offset mortar.
  if (wy < 1.5) return trim();
  if (wx > 3 && wx < 10 && wy > 4 && wy < 14) {
    if (wx < 4 || wy < 5 || Math.abs(wx - 6.5) < .5) return tint(55, 61, 65);
    return hash(col, row, seed + p.id) > .45 ? tint(225, 179, 103) : tint(48, 77, 92);
  }
  if (wy > 2 && wy < 3.5 && wx > 1) return tint(79, 82, 80);
  const mortar = dy % 4 < .6 || (dx + Math.floor(dy / 4) % 2 * 4) % 8 < .6;
  return mortar ? tint(126, 113, 98) : p.variant > .5 ? tint(151, 104, 81) : tint(176, 152, 119);
}
