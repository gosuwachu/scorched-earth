import { describe, expect, it } from "vitest";
import { RemoteHold } from "../src/remote";

describe("guest hold timing", () => {
  it("delays repeat for 350 ms, then accelerates independently on each axis", () => {
    const hold = new RemoteHold();
    hold.set(["ArrowLeft", "ArrowUp"], 1000);
    expect(hold.repeat(1349)).toEqual({ angle: 0, power: 0 });
    expect(hold.repeat(1350)).toEqual({ angle: 0, power: 0 });
    hold.set(["ArrowLeft", "ArrowUp"], 1400);
    expect(hold.repeat(1450)).toEqual({ angle: 0, power: 3 });
    expect(hold.repeat(1550)).toEqual({ angle: 1, power: 6 });
    expect(hold.repeat(1550)).toEqual({ angle: 0, power: 0 });
  });

  it("retains fractions at different frame rates and caps prolonged holds", () => {
    for (const interval of [10, 20, 100]) {
      const hold = new RemoteHold();
      const total = { angle: 0, power: 0 };
      hold.set(["ArrowRight", "ArrowDown"], 0);
      for (let now = interval; now <= 1000; now += interval) {
        hold.set(["ArrowRight", "ArrowDown"], now);
        const delta = hold.repeat(now);
        total.angle += delta.angle; total.power += delta.power;
      }
      expect(total).toEqual({ angle: -11, power: -62 });
    }
    const hold = new RemoteHold();
    hold.set(["ArrowLeft", "ArrowUp"], 0);
    for (let now = 100; now <= 3000; now += 100) hold.set(["ArrowLeft", "ArrowUp"], now);
    hold.repeat(3000);
    for (let now = 3100; now <= 4000; now += 100) hold.set(["ArrowLeft", "ArrowUp"], now);
    expect(hold.repeat(4000)).toEqual({ angle: 50, power: 250 });
  });

  it("resets even when release and repress occur between rendered frames", () => {
    const hold = new RemoteHold();
    hold.set(["ArrowLeft", "ArrowUp"], 0);
    hold.set(["ArrowLeft", "ArrowUp"], 400);
    hold.repeat(600);
    hold.set(["ArrowUp"], 610);
    hold.set(["ArrowLeft", "ArrowUp"], 620);
    expect(hold.repeat(700)).toEqual({ angle: 0, power: 9 });
    hold.set(["ArrowLeft", "ArrowUp"], 900);
    expect(hold.repeat(970).angle).toBe(0);
    expect(hold.repeat(1110).angle).toBe(1);
  });

  it("cancels opposing directions and restarts the delay after reversal", () => {
    const hold = new RemoteHold();
    hold.set(["ArrowLeft"], 0);
    hold.set(["ArrowLeft"], 400);
    expect(hold.repeat(600).angle).toBe(2);
    hold.set(["ArrowLeft", "ArrowRight"], 610);
    expect(hold.repeat(700).angle).toBe(0);
    hold.set(["ArrowRight"], 710);
    expect(hold.repeat(1060).angle).toBe(0);
    expect(hold.repeat(1200).angle).toBe(-1);
  });

  it("drops repeat state on expiry and explicit release", () => {
    for (const release of [false, true]) {
      const hold = new RemoteHold();
      hold.set(["ArrowUp"], 0);
      hold.set(["ArrowUp"], 400);
      expect(hold.repeat(600).power).toBeGreaterThan(0);
      if (release) hold.clear();
      expect(hold.repeat(900)).toEqual({ angle: 0, power: 0 });
      hold.set(["ArrowUp"], 1000);
      expect(hold.repeat(1350)).toEqual({ angle: 0, power: 0 });
    }
  });
});

describe("guest target hold timing", () => {
  it("delays for 350 ms, moves both axes equally and retains fractions across frame rates", () => {
    for (const interval of [10, 20, 100]) {
      const hold = new RemoteHold();
      const total = { x: 0, y: 0 };
      hold.set(["ArrowRight", "ArrowUp"], 0);
      for (let now = interval; now <= 1000; now += interval) {
        hold.set(["ArrowRight", "ArrowUp"], now);
        const delta = hold.repeatTarget(now);
        if (now <= 350) expect(delta).toEqual({ x: 0, y: 0 });
        total.x += delta.x; total.y += delta.y;
      }
      expect(total).toEqual({ x: 62, y: -62 });
      expect(hold.repeatTarget(1000)).toEqual({ x: 0, y: 0 });
    }
  });

  it("caps both axes at 250 pixels per second", () => {
    const hold = new RemoteHold();
    hold.set(["ArrowLeft", "ArrowDown"], 0);
    for (let now = 100; now <= 3000; now += 100) hold.set(["ArrowLeft", "ArrowDown"], now);
    hold.repeatTarget(3000);
    for (let now = 3100; now <= 4000; now += 100) hold.set(["ArrowLeft", "ArrowDown"], now);
    expect(hold.repeatTarget(4000)).toEqual({ x: -250, y: 250 });
  });

  it("cancels opposing directions and restarts the delay on reversal or re-press", () => {
    const hold = new RemoteHold();
    hold.set(["ArrowRight"], 0);
    hold.set(["ArrowRight"], 400);
    expect(hold.repeatTarget(600)).toEqual({ x: 13, y: 0 });
    hold.set(["ArrowLeft", "ArrowRight"], 610);
    expect(hold.repeatTarget(700)).toEqual({ x: 0, y: 0 });
    hold.set(["ArrowLeft"], 710);
    expect(hold.repeatTarget(1060)).toEqual({ x: 0, y: 0 });
    hold.set(["ArrowLeft"], 1100);
    expect(hold.repeatTarget(1160)).toEqual({ x: -3, y: 0 });
    hold.set([], 1170); hold.set(["ArrowLeft"], 1180);
    expect(hold.repeatTarget(1530)).toEqual({ x: 0, y: 0 });
  });

  it.each([false, true])("stops and resets after explicit release=%s or heartbeat expiry", (release) => {
    const hold = new RemoteHold();
    hold.set(["ArrowDown"], 0); hold.set(["ArrowDown"], 400);
    expect(hold.repeatTarget(600).y).toBeGreaterThan(0);
    if (release) hold.clear();
    expect(hold.repeatTarget(900)).toEqual({ x: 0, y: 0 });
    hold.set(["ArrowDown"], 1000);
    expect(hold.repeatTarget(1350)).toEqual({ x: 0, y: 0 });
  });
});
