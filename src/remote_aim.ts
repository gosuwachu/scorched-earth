/** Guest controller ergonomics, independent of local/DOS input pacing. */
class RepeatAxis {
  private direction = 0;
  private started = 0;
  private emitted = 0;

  constructor(private initial: number, private acceleration: number, private maximum: number) {}

  set(direction: number, now: number): void {
    if (direction === this.direction) return;
    this.direction = direction;
    this.started = now;
    this.emitted = 0;
  }

  take(now: number): number {
    if (!this.direction) return 0;
    const elapsed = Math.max(0, (now - this.started - 350) / 1000);
    const ramp = Math.min(elapsed, (this.maximum - this.initial) / this.acceleration);
    // Integrate the ramp exactly so fractional movement survives at any frame
    // rate. Only time after the 350 ms delay contributes to hold repetition.
    const total = Math.floor(this.initial * ramp + this.acceleration * ramp * ramp / 2 +
      this.maximum * (elapsed - ramp));
    const delta = total - this.emitted;
    this.emitted = total;
    return delta === 0 ? 0 : delta * this.direction;
  }
}

export class RemoteAimRepeat {
  private angle = new RepeatAxis(6, 35, 50);
  private power = new RepeatAxis(25, 220, 250);

  set(angle: number, power: number, now: number): void {
    this.angle.set(angle, now);
    this.power.set(power, now);
  }

  clear(): void { this.set(0, 0, 0); }

  take(now: number): { angle: number; power: number } {
    return { angle: this.angle.take(now), power: this.power.take(now) };
  }
}

/** Screen coordinates use the power ramp equally in both directions. */
export class RemoteTargetRepeat {
  private x = new RepeatAxis(25, 220, 250);
  private y = new RepeatAxis(25, 220, 250);

  set(x: number, y: number, now: number): void {
    this.x.set(x, now);
    this.y.set(y, now);
  }

  clear(): void { this.set(0, 0, 0); }

  take(now: number): { x: number; y: number } {
    return { x: this.x.take(now), y: this.y.take(now) };
  }
}
