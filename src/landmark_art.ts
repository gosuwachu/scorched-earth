/** Original, stylised landmark facades. No downloaded photography or logos.
 * Each sample is painted only where the shared collision silhouette exists. */
import { hash, type Prop } from "./modern";
import { suspensionCable } from "./city_shapes";
type RGB = [number, number, number];
export function landmarkColor(p: Prop, x: number, y: number, seed: number): RGB | null {
  const u = (x - p.x) / p.w, v = (p.y - y) / p.h;
  const dx = x - p.x + p.w / 2, dy = p.y - y;
  const grain = (hash(Math.floor(x * 2), Math.floor(y * 2), seed) - .5) * 13;
  const light = grain + 10 - (u + .5) * 22;
  const tint = (r: number, g: number, b: number): RGB => [r + light, g + light, b + light];
  const stone = () => {
    const mortar = dy % 6 < .6 || (dx + Math.floor(dy / 6) % 2 * 7) % 14 < .6;
    return mortar ? tint(149, 143, 126) : tint(194, 182, 151);
  };
  const glass = (): RGB => tint(47, 99 + v * 35, 128 + v * 30);
  switch (p.kind) {
    case "gherkin": {
      const a = ((u + v * 1.4) % .16 + .16) % .16;
      const b = ((u - v * 1.4) % .16 + .16) % .16;
      if (a < .012 || b < .012 || dy % 12 < .7) return tint(161, 191, 193);
      const stripe = Math.floor((u + v * 1.4 + 3) / .16) % 3;
      const reflection = Math.cos(u * 5) * 27;
      return stripe === 0 ? tint(30, 62, 77) : tint(48 + reflection, 102 + reflection, 130 + reflection);
    }
    case "big_ben": {
      const cx = u / .27, cy = (v - .74) / (.27 * p.w / p.h);
      const r = Math.hypot(cx, cy);
      if (r < 1) {
        if (r > .88 || r > .68 && Math.abs(Math.sin(Math.atan2(cy, cx) * 6)) < .16) return tint(61, 57, 46);
        if (Math.abs(cx + cy) < .055 && cx < .08 && cx > -.48 || Math.abs(cx - cy * .65) < .05 && cx > -.06 && cy < .62 && cy > 0) return tint(36, 43, 47);
        return tint(249, 232, 179);
      }
      if (v > .82) return dy % 6 < 1 ? tint(128, 137, 126) : tint(61, 83, 81);
      if (v % .12 < .014 || Math.abs(u) > .26) return tint(209, 191, 142);
      if (v < .65 && dx % 10 > 3 && dx % 10 < 7) return tint(67, 76, 73);
      return stone();
    }
    case "st_pauls": {
      if (v > .52 && Math.abs(u) < .27) {
        if (v > .83) return tint(187, 171, 125);
        const ribs = Math.cos(Math.asin(Math.max(-1, Math.min(1, u / .26))) * 16);
        return tint(106 + ribs * 18 + (1 - Math.abs(u) * 3) * 25, 122 + ribs * 16, 126 + ribs * 14);
      }
      if (Math.abs(u) > .33 && v > .48) return tint(155, 159, 146);
      if (v > .34 && dx % 9 < 3) return tint(78, 85, 80);
      if (v < .3 && dy > 7 && dx % 16 > 5 && dx % 16 < 11) return tint(61, 73, 74);
      if (v > .29 && v < .34 || dy < 5 || dx % 16 < 2) return tint(219, 208, 179);
      return stone();
    }
    case "bloomberg": {
      if (dy % 17 < 3 || dx % 26 < 4 || v > .95) return stone();
      const fin = dx % 7;
      if (fin < 2.6) return tint(140 + fin * 12, 104 + fin * 8, 64 + fin * 4);
      return glass();
    }
    case "london_eye": {
      const rx = u / .46, ry = (v - .55) / .43, r = Math.hypot(rx, ry);
      if (r > .97 && Math.abs(Math.sin(Math.atan2(ry, rx) * 12)) < .16) return tint(117, 179, 199);
      if (r < .075) return tint(135, 160, 163);
      return tint(220, 232, 225);
    }
    case "golden_gate": {
      if (v > .325 && v < .335) return tint(65, 70, 65);
      const tower = Math.abs(Math.abs(u) - .28) < .035;
      if (tower && dx % 3 < .8) return tint(93, 53, 42);
      if (Math.abs(v - suspensionCable(u)) < .006) return tint(237, 137, 87);
      return tint(197, 64, 45);
    }
    case "bridge": {
      const arch = .64 * Math.sqrt(Math.max(0, 1 - (u / .4) ** 2));
      if (v > .93 || v < arch + .045 && Math.abs(u) < .42) return tint(214, 198, 158);
      return stone();
    }
    case "lighthouse": {
      if (v > .9) return tint(104, 47, 38);
      if (v > .77) return dx % 7 < 1.3 ? tint(46, 59, 62) : tint(255, 221, 137);
      if (v > .73 || v < .06) return tint(62, 74, 76);
      if (Math.abs(u) < .035 && (v > .32 && v < .4 || v > .6 && v < .67)) return tint(35, 71, 84);
      return Math.floor(v * 6) % 2 ? tint(181, 64, 49) : tint(228, 223, 202);
    }
    case "detached": case "semi": case "townhouse": {
      const roof = p.kind === "townhouse" ? .89 : p.kind === "semi" ? .64 : .58;
      if (v > roof) {
        if (p.kind === "semi" && Math.abs(u) < .045 || p.kind === "detached" && u > .22 && u < .3) return tint(139, 78, 53);
        const tile = dy % 4 < .7 || (dx + Math.floor(dy / 4) % 2 * 3) % 6 < .6;
        return tile ? tint(54, 61, 65) : tint(91, 96, 98);
      }
      if (roof - v < .035 || v < .04) return tint(225, 211, 179);
      const unit = p.kind === "semi" ? p.w / 2 : p.kind === "townhouse" ? p.w / 3 : p.w;
      const local = dx % unit;
      const floor = p.kind === "townhouse" ? p.h * .26 : p.h * .26;
      const wy = dy % floor;
      if (dy < floor && local > unit * .42 && local < unit * .59) return tint(43, 83, 83);
      const window = (local > unit * .1 && local < unit * .34) || (local > unit * .66 && local < unit * .9);
      if (window && wy > floor * .3 && wy < floor * .85) {
        if (wy < floor * .39 || wy > floor * .76 || Math.abs(local / unit - .22) < .025 || Math.abs(local / unit - .78) < .025) return tint(227, 220, 193);
        return glass();
      }
      const mortar = dy % 4 < .5 || (dx + Math.floor(dy / 4) % 2 * 4) % 8 < .5;
      if (p.kind === "semi" && v > .35) return tint(218, 207, 176);
      return mortar ? tint(163, 140, 112) : tint(157, 89, 62);
    }
    default: return null;
  }
}
