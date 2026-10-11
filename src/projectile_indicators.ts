/** Browser visibility aid only: no projectile or simulation state is changed. */
export const INDICATOR_MARGIN = 8;
export const INDICATOR_ARROW_SIZE = 12;
const PADDING = 4;
const GAP = 3;

interface Position { sx: number; sy: number }
type Edge = "top" | "bottom" | "left" | "right";

export interface ProjectileIndicator {
  x: number; y: number; width: number; height: number;
  arrowX: number; arrowY: number; angle: number;
  textX: number; textY: number; textWidth: number;
  lines: string[];
  count: number;
  distance: number;
}

interface Group {
  nearest: Position;
  distance: number;
  edge: Edge;
  count: number;
}

const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value));

/** Place complete badges inside the field, below the HUD/wind reservation.
 * Distance is to the actual field, not the inset used to keep the badges visible.
 * Nearby badges merge around the nearest missile, with a stable spatial tie-break.
 */
export function layoutProjectileIndicators(
  positions: readonly Position[], width: number, height: number, topInset: number,
  measureText: (text: string) => number, lineHeight = 11,
): ProjectileIndicator[] {
  const top = Math.max(INDICATOR_MARGIN, topInset);
  const availableWidth = width - 2 * INDICATOR_MARGIN;
  const availableHeight = height - INDICATOR_MARGIN - top;
  if (!Number.isFinite(availableWidth) || !Number.isFinite(availableHeight) ||
      availableWidth < 2 * PADDING + INDICATOR_ARROW_SIZE + GAP + 1 ||
      availableHeight < 2 * PADDING + INDICATOR_ARROW_SIZE + GAP + 2 * lineHeight) return [];

  const groups: Group[] = [];
  for (const p of positions) {
    if (!Number.isFinite(p.sx) || !Number.isFinite(p.sy) ||
        (p.sx >= 0 && p.sx < width && p.sy >= 0 && p.sy < height)) continue;
    const distance = Math.hypot(p.sx - clamp(p.sx, 0, width - 1), p.sy - clamp(p.sy, 0, height - 1));
    if (!Number.isFinite(distance)) continue;
    groups.push({ nearest: p, distance, count: 1,
      edge: p.sy < 0 ? "top" : p.sy >= height ? "bottom" : p.sx < 0 ? "left" : "right" });
  }
  groups.sort((a, b) => a.distance - b.distance || a.nearest.sx - b.nearest.sx || a.nearest.sy - b.nearest.sy);

  const badge = (g: Group): ProjectileIndicator => {
    const distance = Math.ceil(g.distance);
    const lines = g.count === 1 ? [`${distance} px`] : [`${g.count} missiles`, `nearest ${distance} px`];
    const vertical = g.edge === "top" || g.edge === "bottom";
    const textWidth = Math.max(...lines.map(measureText));
    const textHeight = lines.length * lineHeight;
    const w = Math.min(availableWidth, 2 * PADDING + (vertical ? Math.max(INDICATOR_ARROW_SIZE, textWidth) : INDICATOR_ARROW_SIZE + GAP + textWidth));
    const h = 2 * PADDING + (vertical ? INDICATOR_ARROW_SIZE + GAP + textHeight : Math.max(INDICATOR_ARROW_SIZE, textHeight));
    const x = clamp(g.nearest.sx - w / 2, INDICATOR_MARGIN, width - INDICATOR_MARGIN - w);
    const y = clamp(g.nearest.sy - h / 2, top, height - INDICATOR_MARGIN - h);
    const arrowX = vertical ? x + w / 2 : g.edge === "left" ? x + PADDING + INDICATOR_ARROW_SIZE / 2 : x + w - PADDING - INDICATOR_ARROW_SIZE / 2;
    const arrowY = !vertical ? y + h / 2 : g.edge === "top" ? y + PADDING + INDICATOR_ARROW_SIZE / 2 : y + h - PADDING - INDICATOR_ARROW_SIZE / 2;
    return {
      x, y, width: w, height: h, arrowX, arrowY,
      angle: Math.atan2(g.nearest.sy - arrowY, g.nearest.sx - arrowX) + Math.PI / 2,
      textX: x + PADDING + (g.edge === "left" ? INDICATOR_ARROW_SIZE + GAP : 0),
      textY: vertical ? y + PADDING + (g.edge === "top" ? INDICATOR_ARROW_SIZE + GAP : 0) : y + (h - textHeight) / 2,
      textWidth: w - 2 * PADDING - (vertical ? 0 : INDICATOR_ARROW_SIZE + GAP),
      lines, count: g.count, distance,
    };
  };

  const result = groups.map(badge);
  // Each merge removes a group. Restart because its larger count label can
  // overlap another badge, including one on the adjacent edge at a corner.
  for (let i = 0; i < result.length; i++) {
    for (let j = i + 1; j < result.length; j++) {
      const a = result[i], b = result[j];
      if (a.x + a.width + INDICATOR_MARGIN <= b.x || b.x + b.width + INDICATOR_MARGIN <= a.x ||
          a.y + a.height + INDICATOR_MARGIN <= b.y || b.y + b.height + INDICATOR_MARGIN <= a.y) continue;
      groups[i].count += groups[j].count;
      groups.splice(j, 1);
      result[i] = badge(groups[i]);
      result.splice(j, 1);
      i = -1;
      break;
    }
  }
  return result;
}
