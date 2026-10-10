/** Browser visibility enhancement, independent of DOS TRACE and simulation time. */
export const TRAIL_LIFETIME_MS = 150;
const TRAIL_OPACITY = 0.65;

interface Position {
  sx: number;
  sy: number;
}

interface Sample {
  x: number;
  y: number;
  time: number;
}

export interface TrailPixel {
  x: number;
  y: number;
  opacity: number;
}

export class ProjectileTrails {
  private previous = new Map<Position, Sample>();
  // One sample per visible pixel bounds storage and avoids stacking opacity
  // where trajectories cross. The most recent passage owns the pixel.
  private pixels = new Map<number, Sample>();
  private lastTime = -Infinity;

  constructor(private width: number, private height: number) {}

  clear(): void {
    this.previous.clear();
    this.pixels.clear();
    this.lastTime = -Infinity;
  }

  update(projectiles: readonly Position[], nowMs: number): TrailPixel[] {
    if (nowMs < this.lastTime) this.clear();
    this.lastTime = nowMs;
    for (const [key, sample] of this.pixels) {
      if (nowMs - sample.time >= TRAIL_LIFETIME_MS) this.pixels.delete(key);
    }

    const current = new Map<Position, Sample>();
    for (const p of projectiles) {
      const point = { x: p.sx, y: p.sy, time: nowMs };
      const prev = this.previous.get(p);
      current.set(p, point);
      if (!prev) continue;
      const dx = point.x - prev.x, dy = point.y - prev.y;
      const elapsed = nowMs - prev.time;
      // Do not bridge teleports (including the DOS Concrete opposite-edge
      // bounce) or gaps after a suspended tab. Stationary shots just age out.
      if (elapsed <= 0 || elapsed >= TRAIL_LIFETIME_MS ||
          Math.abs(dx) > this.width / 2 || Math.abs(dy) > this.height / 2) continue;
      const steps = Math.max(Math.abs(dx), Math.abs(dy));
      for (let i = 0; steps > 0 && i <= steps; i++) {
        const fraction = i / steps;
        const x = Math.round(prev.x + dx * fraction);
        const y = Math.round(prev.y + dy * fraction);
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) continue;
        const time = prev.time + elapsed * fraction;
        const key = y * this.width + x;
        if (time >= (this.pixels.get(key)?.time ?? -Infinity)) {
          this.pixels.set(key, { x, y, time });
        }
      }
    }
    // Removed shots stop sampling, but their pixels finish fading naturally.
    this.previous = current;
    return Array.from(this.pixels.values(), ({ x, y, time }) => ({
      x, y, opacity: TRAIL_OPACITY * (1 - (nowMs - time) / TRAIL_LIFETIME_MS),
    }));
  }
}
