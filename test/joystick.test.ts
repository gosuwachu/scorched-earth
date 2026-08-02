/**
 * Differential gate: TS src/joystick.ts == scorch/joystick.py (catalog 17 s.1.3:
 * FUN_583d_0005 detect, FUN_54e7_0213 poll-then-redraw cursor).  Mirrors
 * tests/test_re_equivalence.py 9d: Calibration.deflect math, the pointer-path
 * gating (mode + stick + calibration), the PX_PER_POLL advance, and the
 * screen-edge clamp.  The Python test pokes module state (`_cursor`, `_joy`,
 * `_cal`) directly; the TS seams are set_device / set_calibration /
 * get_calibration / reset_for_tests, and the recenter-on-calibration behavior
 * is what positions the cursor for the advance assertions.
 */
import { beforeEach, describe, expect, it } from "vitest";
import * as joystick from "../src/joystick";

/** Fake joystick device (the Python _FakeJoyDev shape: get_axis/get_button/
 * get_name over mutable axes/btn, so tests can drive it). */
class FakeJoyDev {
  axes: [number, number];
  btn: boolean;

  constructor(ax0 = 0.0, ax1 = 0.0, btn = false) {
    this.axes = [ax0, ax1];
    this.btn = btn;
  }

  get_axis(i: number): number {
    return this.axes[i];
  }

  get_button(_b: number): boolean {
    return this.btn;
  }

  get_name(): string {
    return "fake";
  }
}

describe("joystick: Calibration.deflect (center/range math)", () => {
  beforeEach(() => {
    joystick.reset_for_tests();
  });

  it("at center -> no deflection", () => {
    const cal = new joystick.Calibration(0.1, -0.05, 0.5, 0.25, true);
    expect(cal.deflect(0.1, -0.05)).toEqual([0.0, 0.0]);
  });

  it("full deflection clamps to 1.0", () => {
    const cal = new joystick.Calibration(0.1, -0.05, 0.5, 0.25, true);
    const [dx, dy] = cal.deflect(0.6, 0.2);
    expect(Math.abs(dx - 1.0)).toBeLessThan(1e-9);
    expect(Math.abs(dy - 1.0)).toBeLessThan(1e-9);
  });

  it("half x deflection", () => {
    const cal = new joystick.Calibration(0.1, -0.05, 0.5, 0.25, true);
    const [dx, dy] = cal.deflect(0.35, -0.05);
    expect(Math.abs(dx - 0.5)).toBeLessThan(1e-9);
    expect(dy).toBe(0.0);
  });

  it("zero/negative range floored to 1.0", () => {
    const cal0 = new joystick.Calibration(0, 0, 0, -1);
    expect(cal0.deflect(0.0, 0.0)).toEqual([0.0, 0.0]);
  });
});

describe("joystick: pointer path (mode + stick + calibration gating)", () => {
  beforeEach(() => {
    joystick.reset_for_tests();
  });

  it("not active without a stick", () => {
    joystick.set_pointer_mode("Joystick");
    expect(joystick.active()).toBe(false);
  });

  it("active with mode+stick+calibration", () => {
    joystick.set_pointer_mode("Joystick");
    joystick.set_device(new joystick.Joystick(new FakeJoyDev(0.1, -0.05)));
    joystick.set_calibration(new joystick.Calibration(0.1, -0.05, 0.5, 0.25, true));
    expect(joystick.active()).toBe(true);
  });

  it("reset_for_tests restores Mouse mode", () => {
    joystick.set_pointer_mode("Joystick");
    joystick.reset_for_tests();
    expect(joystick.active()).toBe(false);
  });

  it("inactive peek falls back to the mouse-pos provider", () => {
    joystick.setMousePosProvider(() => [11, 22]);
    expect(joystick.peek_pointer_pos()).toEqual([11, 22]);
  });
});

describe("joystick: cursor advance + clamp (FUN_54e7_0213)", () => {
  beforeEach(() => {
    joystick.reset_for_tests();
  });

  it("centered axes: no drift", () => {
    joystick.set_pointer_mode("Joystick");
    joystick.set_device(new joystick.Joystick(new FakeJoyDev(0.1, -0.05)));
    // a fresh calibration recenters the cursor at screen center (1024x768)
    joystick.set_calibration(new joystick.Calibration(0.1, -0.05, 0.5, 0.25, true));
    joystick.advance_pointer(); // axes == center -> no move
    expect(joystick.peek_pointer_pos()).toEqual([512, 384]);
  });

  it("full deflection moves PX_PER_POLL px", () => {
    joystick.set_pointer_mode("Joystick");
    joystick.set_device(new joystick.Joystick(new FakeJoyDev(0.6, 0.2))); // (1.0, 1.0)
    joystick.set_calibration(new joystick.Calibration(0.1, -0.05, 0.5, 0.25, true));
    joystick.advance_pointer();
    expect(joystick.peek_pointer_pos()).toEqual([
      512 + joystick.PX_PER_POLL,
      384 + joystick.PX_PER_POLL,
    ]);
  });

  it("clamps to the screen edge", () => {
    joystick.set_pointer_mode("Joystick");
    joystick.set_device(new joystick.Joystick(new FakeJoyDev(0.6, 0.2)));
    joystick.set_screen_size([8, 8]); // recenter -> [4, 4]
    joystick.set_calibration(new joystick.Calibration(0.1, -0.05, 0.5, 0.25, true));
    joystick.advance_pointer(); // +5 both axes -> clamped to [7, 7]
    expect(joystick.peek_pointer_pos()).toEqual([7, 7]);
  });
});
