import { describe, expect, it } from "vitest";
import { layoutProjectileIndicators, type ProjectileIndicator } from "../src/projectile_indicators";

// Browser presentation rules, not DOS physics/visual reference data.
const measure = (text: string): number => text.length * 5.5;
const layout = (positions: { sx: number; sy: number }[], top = 60) =>
  layoutProjectileIndicators(positions, 1024, 768, top, measure);

function inBounds(marker: ProjectileIndicator, width = 1024, height = 768, top = 60): void {
  expect(marker.x).toBeGreaterThanOrEqual(8);
  expect(marker.y).toBeGreaterThanOrEqual(top);
  expect(marker.x + marker.width).toBeLessThanOrEqual(width - 8);
  expect(marker.y + marker.height).toBeLessThanOrEqual(height - 8);
  expect(marker.arrowX).toBeGreaterThan(marker.x);
  expect(marker.arrowX).toBeLessThan(marker.x + marker.width);
  expect(marker.arrowY).toBeGreaterThan(marker.y);
  expect(marker.arrowY).toBeLessThan(marker.y + marker.height);
  expect(marker.textWidth).toBeGreaterThan(0);
}

describe("off-screen missile indicators", () => {
  it.each([
    [512, -240, 240, "top"], [512, 847, 80, "bottom"],
    [-50, 400, 50, "left"], [1103, 400, 80, "right"],
    [-3, -4, 5, "top"], [1026, -4, 5, "top"],
    [-3, 771, 5, "bottom"], [1026, 771, 5, "bottom"],
  ] as const)("places (%s, %s) at the %s-pixel distance on the %s edge", (sx, sy, distance, edge) => {
    const [marker] = layout([{ sx, sy }]);
    inBounds(marker);
    expect(marker.distance).toBe(distance);
    expect(marker.lines).toEqual([`${distance} px`]);
    expect(marker.count).toBe(1);
    if (edge === "top") expect(marker.y).toBe(60);
    if (edge === "bottom") expect(marker.y + marker.height).toBe(760);
    if (edge === "left") expect(marker.x).toBe(8);
    if (edge === "right") expect(marker.x + marker.width).toBe(1016);
    const dx = sx - marker.arrowX, dy = sy - marker.arrowY;
    // Rotation of the initially upward arrow must aim at the actual missile.
    expect(Math.sin(marker.angle)).toBeCloseTo(dx / Math.hypot(dx, dy), 12);
    expect(-Math.cos(marker.angle)).toBeCloseTo(dy / Math.hypot(dx, dy), 12);
  });

  it("treats on-screen boundaries and HUD-obscured shots as visible", () => {
    expect(layout([{ sx: 0, sy: 0 }, { sx: 1023, sy: 0 }, { sx: 0, sy: 767 },
      { sx: 1023, sy: 767 }, { sx: 512, sy: 20 }])).toEqual([]);
    for (const p of [{ sx: -1, sy: 400 }, { sx: 1024, sy: 400 }, { sx: 500, sy: -1 }, { sx: 500, sy: 768 }]) {
      expect(layout([p])[0].distance).toBe(1);
    }
  });

  it("rounds distances up and does not include the HUD reservation", () => {
    const p = { sx: -2, sy: -2 };
    expect(layout([p], 8)[0].distance).toBe(3);
    expect(layout([p], 120)[0].distance).toBe(3);
    expect(layout([p], 120)[0].y).toBe(120);
  });

  it("groups nearby missiles, reports the nearest one and keeps distant markers separate", () => {
    const positions = [{ sx: 300, sy: -100 }, { sx: 310, sy: -200 }, { sx: 800, sy: -250 }];
    const markers = layout(positions);
    expect(markers).toHaveLength(2);
    expect(markers[0].lines).toEqual(["2 missiles", "nearest 100 px"]);
    expect(markers[0].count).toBe(2);
    expect(markers[0].angle).toBe(0);
    expect(markers[1].lines).toEqual(["250 px"]);
    markers.forEach((marker) => inBounds(marker));
    expect(layout([...positions].reverse())).toEqual(markers);
  });

  it("merges corner overlaps across edges and reaches a non-overlapping layout for dense volleys", () => {
    const corner = layout([{ sx: 5, sy: -10 }, { sx: -10, sy: 65 }]);
    expect(corner).toHaveLength(1);
    expect(corner[0].count).toBe(2);
    const positions = Array.from({ length: 64 }, (_, i) => ({ sx: i * 17, sy: -20 - (i % 7) }));
    const markers = layout(positions);
    expect(markers.reduce((sum, m) => sum + m.count, 0)).toBe(64);
    expect(markers.length).toBeLessThan(10);
    expect(layout([...positions].reverse())).toEqual(markers);
    for (const [i, a] of markers.entries()) {
      inBounds(a);
      for (const b of markers.slice(i + 1)) {
        expect(a.x + a.width + 8 <= b.x || b.x + b.width + 8 <= a.x ||
          a.y + a.height + 8 <= b.y || b.y + b.height + 8 <= a.y).toBe(true);
      }
    }
  });

  it("separates moving groups and removes markers immediately without retaining history", () => {
    const a = { sx: 300, sy: -100 }, b = { sx: 310, sy: -200 };
    expect(layout([a, b])).toHaveLength(1);
    b.sx = 800;
    expect(layout([a, b])).toHaveLength(2);
    a.sy = 0;
    expect(layout([a, b])).toHaveLength(1);
    expect(layout([])).toEqual([]);
    expect(layout([a])).toEqual([]);
  });

  it("keeps labels and arrows inside smaller fields and skips invalid coordinates", () => {
    const positions = [{ sx: -100, sy: -100 }, { sx: 1000, sy: 1000 }];
    for (const marker of layoutProjectileIndicators(positions, 320, 240, 70, measure)) inBounds(marker, 320, 240, 70);
    expect(layout([{ sx: NaN, sy: -1 }, { sx: 1, sy: Infinity }, { sx: -Infinity, sy: 5 }])).toEqual([]);
    expect(layoutProjectileIndicators(positions, 40, 40, 60, measure)).toEqual([]);
  });

  it("does not modify its input positions", () => {
    const positions = Object.freeze([Object.freeze({ sx: 200, sy: -100 }), Object.freeze({ sx: 205, sy: -200 })]);
    expect(layoutProjectileIndicators(positions, 1024, 768, 60, measure)[0].count).toBe(2);
    expect(positions).toEqual([{ sx: 200, sy: -100 }, { sx: 205, sy: -200 }]);
  });
});
