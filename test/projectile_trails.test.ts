import { describe, expect, it } from "vitest";
import { ProjectileTrails } from "../src/projectile_trails";

describe("browser projectile visibility trails", () => {
  it("interpolates a continuous streak and fades every pixel within 150 ms", () => {
    const trails = new ProjectileTrails(100, 100);
    const p = { sx: 10, sy: 10 };
    expect(trails.update([p], 0)).toEqual([]);
    p.sx = 20;
    const pixels = trails.update([p], 50);
    expect(pixels.map(({ x, y }) => [x, y])).toEqual(
      Array.from({ length: 11 }, (_, i) => [10 + i, 10]),
    );
    expect(pixels[0].opacity).toBeCloseTo(0.65 * 2 / 3);
    expect(pixels[10].opacity).toBe(0.65);
    const fading = trails.update([], 125);
    expect(fading[fading.length - 1]?.opacity).toBeCloseTo(0.325);
    expect(trails.update([], 200)).toEqual([]);
  });

  it("ages stationary shots without refreshing the streak", () => {
    const trails = new ProjectileTrails(100, 100);
    const p = { sx: 10, sy: 10 };
    trails.update([p], 0);
    p.sx = 20;
    trails.update([p], 25);
    for (const time of [50, 100, 150]) trails.update([p], time);
    expect(trails.update([p], 175)).toEqual([]);
    p.sx = 25;
    expect(trails.update([p], 200).map(({ x }) => x)).toEqual([20, 21, 22, 23, 24, 25]);
  });

  it("tracks simultaneous shots and newly split warheads independently", () => {
    const trails = new ProjectileTrails(100, 100);
    const parent = { sx: 10, sy: 10 }, other = { sx: 80, sy: 80 };
    trails.update([parent, other], 0);
    parent.sx = 20; other.sx = 70;
    const child = { sx: 20, sy: 10 };
    trails.update([other, parent, child], 25);
    parent.sx = 30; child.sy = 20;
    const pixels = trails.update([parent, child], 50);
    expect(pixels.some(({ x, y }) => x === 20 && y === 15)).toBe(true);
    expect(pixels.some(({ x, y }) => x === 75 && y === 80)).toBe(true);
    expect(pixels.every(({ x, y }) => y === 10 || y === 80 || x === 20)).toBe(true);
    expect(new Set(pixels.map(({ x, y }) => `${x},${y}`)).size).toBe(pixels.length);
  });

  it("does not bridge opposite edges, missing observations, or suspended tabs", () => {
    const trails = new ProjectileTrails(100, 100);
    const p = { sx: 99, sy: 10 };
    trails.update([p], 0);
    p.sx = 0;
    expect(trails.update([p], 25)).toEqual([]);
    p.sy = 99;
    expect(trails.update([p], 50)).toEqual([]);
    p.sx = 10;
    expect(trails.update([p], 250)).toEqual([]);
    trails.update([], 260);
    p.sx = 20;
    expect(trails.update([p], 270)).toEqual([]);
  });

  it("clips offscreen samples without painting an artificial edge streak", () => {
    const trails = new ProjectileTrails(100, 100);
    const p = { sx: -10, sy: 10 };
    trails.update([p], 0);
    p.sx = 10;
    const pixels = trails.update([p], 25);
    expect(pixels).toHaveLength(11);
    expect(pixels.every(({ x, y }) => x >= 0 && x <= 10 && y === 10)).toBe(true);
  });

  it("clears retained pixels and sample origins on reset or a backwards clock", () => {
    const trails = new ProjectileTrails(100, 100);
    const p = { sx: 10, sy: 10 };
    trails.update([p], 0);
    p.sx = 20;
    expect(trails.update([p], 25).length).toBeGreaterThan(0);
    trails.clear();
    expect(trails.update([p], 50)).toEqual([]);
    p.sx = 30;
    trails.update([p], 75);
    expect(trails.update([p], 0)).toEqual([]);
  });

  it("does not accumulate pixels when a frame is rendered repeatedly", () => {
    const trails = new ProjectileTrails(100, 100);
    const p = { sx: 10, sy: 10 };
    trails.update([p], 0);
    p.sx = 20;
    const first = trails.update([p], 25);
    expect(trails.update([p], 25)).toEqual(first);
  });
});
