/**
 * Joystick input + calibration (catalog 17 s.1.3; FUN_583d_0005 detect).
 *
 * A faithful TypeScript port of scorch-py/scorch/joystick.py (the fidelity
 * oracle), which mirrors the binary's device layer: FUN_583d_0005
 * detects/calibrates the stick (times pot-charge decay via FUN_5834/FUN_5838,
 * stores the center at [-0x65ee]/[-0x65ea]), returning 0 present / 0xffff
 * absent; the unified pointer (FUN_54e7_0213) polls the axes and moves the
 * software cursor.  Calibration is runtime-only -- the original persists no
 * joystick calibration to scorch.cfg (config schema: HARDWARE_DELAY /
 * joystick keys 0 hits), so neither does this module.
 *
 * The Python port has no DOS pot-charge hardware either; it wraps pygame's
 * normalized -1..1 axes.  The browser analog is the Gamepad API
 * (gamepad.axes[0/1] in -1..1), so detect() wraps the first connected pad.
 * The protocol (detect -> measure center -> measure range -> deflect) is
 * faithful; the raw units are the browser's.  The device is wrapped so tests
 * can inject a fake (same interface: get_axis/get_button/get_name -- the
 * Python _FakeJoyDev shape).
 *
 * Cursor movement mirrors FUN_54e7_0213's poll-then-redraw: one advance per
 * frame, done at the cursor draw site; hit-tests read peek_pointer_pos() so
 * they track the drawn cursor.  pygame.mouse.get_pos() (the inactive-state
 * fallback) has no shim, so it is wired through an integrator-supplied
 * provider (setMousePosProvider), exactly as widgets.ts wires the cursor /
 * ingame.ts wires the mouse state.
 */

/** Pointer mode, synced from cfg POINTER by the Hardware menu selector and at
 * boot (screens.ts / main.ts).  "Joystick" enables the joystick pointer path. */
let POINTER = "Mouse";

/** Cursor pixels per full-deflection poll.  The binary moves the cursor a fixed
 * amount per poll proportional to the axis reading; this is the port constant. */
export const PX_PER_POLL = 5.0;

/** The device surface a Joystick wraps (pygame joystick, Gamepad adapter, or a
 * test fake).  Mirrors joystick.py: get_axis/get_button/get_name. */
export interface JoyDevice {
  get_axis(i: number): number;
  get_button(b: number): boolean;
  get_name(): string;
}

/** Center + range of the stick in raw (gamepad -1..1) units.
 *
 * deflect() maps a raw read to a normalized (-1..1) deflection, the port
 * equivalent of the binary's (pot_read - center) / range cursor step. */
export class Calibration {
  center_x: number;
  center_y: number;
  range_x: number;
  range_y: number;
  present: boolean;

  constructor(
    center_x = 0.0,
    center_y = 0.0,
    range_x = 1.0,
    range_y = 1.0,
    present = false,
  ) {
    this.center_x = center_x;
    this.center_y = center_y;
    this.range_x = range_x > 0 ? range_x : 1.0;
    this.range_y = range_y > 0 ? range_y : 1.0;
    this.present = present;
  }

  deflect(x: number, y: number): [number, number] {
    const dx = Math.max(-1.0, Math.min(1.0, (x - this.center_x) / this.range_x));
    const dy = Math.max(-1.0, Math.min(1.0, (y - this.center_y) / this.range_y));
    return [dx, dy];
  }
}

/** Wraps a gamepad (or a test fake with the same three methods). */
export class Joystick {
  device: JoyDevice;

  constructor(device: JoyDevice) {
    this.device = device;
  }

  axes(): [number, number] {
    return [this.device.get_axis(0), this.device.get_axis(1)];
  }

  fire_down(): boolean {
    return this.device.get_button(0);
  }

  name(): string {
    try {
      return this.device.get_name();
    } catch {
      return "?";
    }
  }
}

/** Browser bridge: a Gamepad API pad presented as a JoyDevice.  Axes/buttons
 * the pad does not expose read as 0/false (the Gamepad API returns undefined
 * for out-of-range reads; the Python port's pygame raises there instead). */
class GamepadDevice implements JoyDevice {
  private pad: Gamepad;

  constructor(pad: Gamepad) {
    this.pad = pad;
  }

  get_axis(i: number): number {
    return this.pad.axes[i] ?? 0;
  }

  get_button(b: number): boolean {
    return Boolean(this.pad.buttons[b]?.pressed);
  }

  get_name(): string {
    return this.pad.id;
  }
}

let _joy: Joystick | null = null; // detected Joystick (cached)
let _cal = new Calibration(); // active calibration (runtime-only, no cfg key)
let _cursor: [number, number] = [640, 384]; // software cursor position (joystick mode)
let _screen: [number, number] = [1024, 768];
let _mousePosProvider: (() => [number, number]) | null = null;

/** Integrator hook: the live mouse position (pygame.mouse.get_pos analog) for
 * peek_pointer_pos()'s inactive-state fallback. */
export function setMousePosProvider(p: () => [number, number]): void {
  _mousePosProvider = p;
}

/** FUN_583d_0005 detect: wrap the first connected gamepad; null if absent. */
export function detect(): Joystick | null {
  if (_joy === null) {
    try {
      // DOM-safe: navigator is touched only inside this function body (the
      // pygame.ts "DOM touched only inside function bodies" convention).
      if (typeof navigator !== "undefined" && typeof navigator.getGamepads === "function") {
        const pads = navigator.getGamepads();
        for (const p of pads) {
          if (p !== null) {
            _joy = new Joystick(new GamepadDevice(p));
            break;
          }
        }
      }
    } catch {
      _joy = null;
    }
  }
  return _joy;
}

export function set_pointer_mode(mode: unknown): void {
  // mirrors joystick.py: `POINTER = str(mode or "Mouse")`
  POINTER = String(mode || "Mouse");
}

/** Joystick pointer path is live (mode + a detected stick + a calibration). */
export function active(): boolean {
  return POINTER === "Joystick" && _joy !== null && _cal.present;
}

export function set_calibration(cal: Calibration): void {
  _cal = cal;
  if (!cal.present) {
    return;
  }
  // Reset the cursor to screen center on a fresh calibration, matching the
  // binary's recenter-on-calibration behavior (FUN_54e7_0575 warp).
  _cursor = [Math.trunc(_screen[0] / 2), Math.trunc(_screen[1] / 2)];
}

/** FUN_54e7_0213 poll: move the software cursor by the deflected axis reading,
 * clamped to the screen.  One call per frame, at the draw site. */
export function advance_pointer(): void {
  if (!active() || _joy === null) {
    return;
  }
  const [dx, dy] = _cal.deflect(..._joy.axes());
  _cursor[0] = Math.max(0, Math.min(_screen[0] - 1, _cursor[0] + dx * PX_PER_POLL));
  _cursor[1] = Math.max(0, Math.min(_screen[1] - 1, _cursor[1] + dy * PX_PER_POLL));
}

/** Position the drawn cursor / hit-tests should use (advance first). */
export function peek_pointer_pos(): [number, number] {
  if (active()) {
    return [_cursor[0], _cursor[1]];
  }
  return _mousePosProvider !== null ? _mousePosProvider() : [0, 0];
}

/** Inject a Joystick (test seam; the module otherwise auto-detects). */
export function set_device(joy: Joystick | null): void {
  _joy = joy;
}

/** Read the active calibration (test seam -- the Python module exposes the
 * module-global `_cal` attribute the same way). */
export function get_calibration(): Calibration {
  return _cal;
}

export function set_screen_size(size: [number, number]): void {
  _screen = size;
}

/** Reset module state (test seam). */
export function reset_for_tests(): void {
  _joy = null;
  _cal = new Calibration();
  _cursor = [640, 384];
  _screen = [1024, 768];
  POINTER = "Mouse";
  _mousePosProvider = null;
}
