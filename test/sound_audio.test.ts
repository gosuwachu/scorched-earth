/**
 * Real-path coverage for src/sound.ts -- the WebAudio playback/fly-loop wiring
 * that the no-AudioContext suites (test/sound.test.ts, test/constants.test.ts)
 * can never reach.  In the Node test env there is no AudioContext, so init()
 * fails and every buffer/source/loop branch stays dark.  Here a MOCK
 * AudioContext is injected on globalThis so init() succeeds and the whole
 * synthesise -> buffer -> source -> play / fly-loop chain runs for real.
 *
 * WHAT IS ASSERTED, AND WHY IT IS NOT THEATRE:
 *   - DIFFERENTIAL (vs the Python oracle, oracle/vectors/sound.json):  the mock
 *     captures the Float32 channel data sound.ts writes into every AudioBuffer
 *     (`data[i] = plane[i] / 32768.0`).  int16 = v * 2^-15 is EXACT in float32,
 *     so reconstructing Math.round(ch[i]*32768) recovers the synthesised int16
 *     plane bit-for-bit.  Every beep()/play() event's captured plane is asserted
 *     == the oracle plane the byte-verified Python _Sfx produced.  This closes
 *     the loop the pure-synthesis tests leave open: it proves play("plasma")
 *     actually BUILDS the plasma tone list AND that the buffer plumbing carries
 *     the oracle-exact samples into both channels.
 *   - CONTRACT (sound.ts's own documented behaviour -- there is no Python
 *     WebAudio analog to diff against, pygame.Sound.play != AudioBufferSource):
 *     cache reuse, stereo duplication, source.start/loop/stop, fly-loop re-pitch
 *     swap-only-on-change, resume() on a suspended context, and the "never
 *     raises" degradation when the context throws.
 *
 * The mock is the DEVICE, never the behaviour under test: sound.ts's control
 * flow and sample math are exercised unmodified.  Real audible output (an actual
 * AudioContext on a speaker) is the only thing that stays browser-only.
 *
 * globalThis is mutated per-test and torn down in afterEach; vitest isolates
 * test files, so neither the singleton in sound.ts nor sibling suites are
 * affected.  Every Sfx here is a fresh `new Sfx()` (the module singleton is
 * never touched, so test/sound.test.ts's init()===false lock stays valid).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect, afterEach, vi } from "vitest";
import { Sfx, sfx } from "../src/sound";
import { HumanController, type HumanState } from "../src/ui";
import { Config } from "../src/config";
import { Tank } from "../src/objects";
import { createGameState, SIM_LIVE } from "../src/game";
import * as ingame from "../src/ingame";
import * as pg from "../src/pygame";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VECTORS = join(__dirname, "..", "oracle", "vectors", "sound.json");

type SquareCase = { freq: number; ms: number; n: number; plane: number[] };
type LowRateCase = { rate: number; freq: number; ms: number; n: number; plane: number[] };
type EventCase =
  | { kind: "seq"; tones: number[][]; plane: number[] }
  | { kind: "tone"; freq: number; ms: number; plane: number[] }
  | { kind: "sweep"; f0: number; f1: number; ms: number; plane: number[] };
type SoundVectors = {
  square: SquareCase[];
  events: { [name: string]: EventCase };
  lowrate: LowRateCase[];
};
const vec = JSON.parse(readFileSync(VECTORS, "utf-8")) as SoundVectors;

/** Oracle steady-tone plane for (freq, ms) -- throws if the battery lacks it. */
function squarePlane(freq: number, ms: number): number[] {
  const c = vec.square.find((s) => s.freq === freq && s.ms === ms);
  if (c === undefined) throw new Error(`oracle has no square (${freq},${ms})`);
  return c.plane;
}

// ---------------------------------------------------------------------------
// Mock WebAudio.  Faithful to the slices of the API sound.ts touches; records
// everything so the wiring can be asserted, and can be told to throw at each
// failure point sound.ts guards.
// ---------------------------------------------------------------------------
class MockBuffer {
  channels: Float32Array[];
  constructor(public numberOfChannels: number, public length: number, public sampleRate: number) {
    this.channels = [];
    for (let c = 0; c < numberOfChannels; c++) this.channels.push(new Float32Array(length));
  }
  getChannelData(c: number): Float32Array {
    return this.channels[c];
  }
}

class MockSource {
  buffer: MockBuffer | null = null;
  loop = false;
  playbackRate = { value: 1 };
  onended: (() => void) | null = null;
  connectCount = 0;
  connections: unknown[] = [];
  startCount = 0;
  stopCount = 0;
  failStop = false;
  constructor(private ctx: MockAudioContext, private failStart: boolean) {}
  connect(dest: unknown): void {
    this.connectCount++;
    this.connections.push(dest);
  }
  start(_when?: number): void {
    if (this.failStart) throw new Error("mock start() blocked");
    this.startCount++;
    this.ctx.started.push(this);
  }
  stop(_when?: number): void {
    if (this.failStop) throw new Error("mock stop() blocked (already stopped)");
    this.stopCount++;
  }
}

class MockGain {
  gain = { value: 1 };
  connections: unknown[] = [];
  connect(dest: unknown): void {
    this.connections.push(dest);
  }
}

class MockAudioContext {
  sampleRate = 44100;
  currentTime = 0;
  destination = {};
  state = "running";
  // capture / introspection
  bufferArgs: Array<{ channels: number; length: number; rate: number }> = [];
  createdBuffers: MockBuffer[] = [];
  createdSources: MockSource[] = [];
  createdGains: MockGain[] = [];
  started: MockSource[] = [];
  createBufferCalls = 0;
  resumeCalls = 0;
  // failure injection
  failCreateBuffer = false;
  failCreateSource = false;
  failCreateGain = false;
  failNextStart = false;
  createBuffer(channels: number, length: number, rate: number): MockBuffer {
    this.createBufferCalls++;
    if (this.failCreateBuffer) throw new Error("mock createBuffer blocked");
    this.bufferArgs.push({ channels, length, rate });
    const b = new MockBuffer(channels, length, rate);
    this.createdBuffers.push(b);
    return b;
  }
  createBufferSource(): MockSource {
    if (this.failCreateSource) throw new Error("mock createBufferSource blocked");
    const s = new MockSource(this, this.failNextStart);
    this.failNextStart = false;
    this.createdSources.push(s);
    return s;
  }
  createGain(): MockGain {
    if (this.failCreateGain) throw new Error("mock createGain blocked");
    const gain = new MockGain();
    this.createdGains.push(gain);
    return gain;
  }
  resume(): void {
    this.resumeCalls++;
  }
}

type MockOpts = { sampleRate?: number; state?: string; noResume?: boolean };
function installMock(opts: MockOpts = {}): void {
  // A constructor that returns an object: `new f()` yields that object.
  const f = function (this: unknown): MockAudioContext {
    const c = new MockAudioContext();
    if (opts.sampleRate !== undefined) c.sampleRate = opts.sampleRate;
    if (opts.state !== undefined) c.state = opts.state;
    if (opts.noResume) (c as unknown as { resume?: unknown }).resume = undefined;
    return c;
  };
  (globalThis as Record<string, unknown>).AudioContext = f;
  delete (globalThis as Record<string, unknown>).webkitAudioContext;
}
function uninstall(): void {
  delete (globalThis as Record<string, unknown>).AudioContext;
  delete (globalThis as Record<string, unknown>).webkitAudioContext;
}

/** The MockAudioContext a fresh Sfx opened (sound.ts stashes it in `_ctx`). */
function ctxOf(s: Sfx): MockAudioContext {
  return (s as unknown as { _ctx: MockAudioContext })._ctx;
}
function flyFreqOf(s: Sfx): number {
  return (s as unknown as { _fly_freq: number })._fly_freq;
}
function flySourceOf(s: Sfx): MockSource | null {
  return (s as unknown as { _fly_source: MockSource | null })._fly_source;
}

/** Reconstruct the synthesised int16 plane from a captured stereo buffer and
 * assert it equals `want` EXACTLY, with both channels identical (the original's
 * column_stack duplication). */
function expectBufferPlane(buf: MockBuffer, want: number[], label: string): void {
  expect(buf.numberOfChannels, `${label} channels`).toBe(2);
  expect(buf.length, `${label} length`).toBe(want.length);
  const a = buf.getChannelData(0);
  const b = buf.getChannelData(1);
  for (let i = 0; i < want.length; i++) {
    const v = Math.round(a[i] * 32768);
    if (v !== want[i]) expect(v, `${label} sample[${i}]`).toBe(want[i]);
    if (b[i] !== a[i]) expect(b[i], `${label} ch1[${i}]`).toBe(a[i]);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  uninstall();
});

describe("sound: human adjustment feedback", () => {
  function setup() {
    installMock();
    const sound = new Sfx();
    sound.init();
    vi.spyOn(sfx, "adjustment").mockImplementation(sound.adjustment.bind(sound));
    const tank = new Tank(0, "Human");
    const cfg = new Config();
    cfg.SOUND = "ON";
    const state: HumanState = { current_shooter: tank, cfg, fire() {} };
    return { sound, ctx: ctxOf(sound), tank, cfg, state };
  }

  it("plays distinct 20 ms tones and limits each type independently to 60 ms", () => {
    const { sound, ctx } = setup();
    sound.adjustment("angle", 45, 46);
    sound.adjustment("power", 500, 501);
    expect(ctx.started).toHaveLength(2);
    expectBufferPlane(ctx.started[0].buffer!, Array.from(sound._square_array(600, 20)), "angle tick");
    expectBufferPlane(ctx.started[1].buffer!, Array.from(sound._square_array(900, 20)), "power tick");
    ctx.currentTime = 0.059;
    sound.adjustment("angle", 46, 47);
    expect(ctx.started).toHaveLength(2);
    ctx.currentTime = 0.060;
    sound.adjustment("angle", 47, 48);
    expect(ctx.started).toHaveLength(3);
  });

  it("does not play or consume the cooldown for muted or unchanged values", () => {
    const { sound, ctx } = setup();
    sound.adjustment("angle", 180, 180);
    sound.adjustment("angle", 45, 46, false);
    sound.enabled = false;
    sound.adjustment("power", 500, 501);
    expect(ctx.started).toHaveLength(0);
    sound.adjustment("angle", 46, 47, true);
    expect(ctx.started).toHaveLength(1);
  });

  it("plays taps and held changes, then stops at limits and on release", () => {
    const { ctx, tank, state, cfg } = setup();
    HumanController.handle(state, { type: pg.KEYDOWN, key: pg.K_LEFT });
    HumanController.handle(state, { type: pg.KEYDOWN, key: pg.K_UP });
    expect([tank.angle, tank.power]).toEqual([46, 501]);
    expect(ctx.started).toHaveLength(2);
    for (let i = 1; i <= 60; i++) {
      ctx.currentTime = i / 60;
      HumanController.update_continuous(state, { [pg.K_LEFT]: true, [pg.K_UP]: true });
    }
    expect(ctx.started.length).toBeGreaterThan(4);
    expect(tank.angle).toBeGreaterThan(46);
    expect(tank.power).toBeGreaterThan(501);
    const count = ctx.started.length;
    tank.angle = 180; tank.power = 1000;
    ctx.currentTime = 2;
    HumanController.update_continuous(state, { [pg.K_LEFT]: true, [pg.K_UP]: true });
    HumanController.handle(state, { type: pg.KEYDOWN, key: pg.K_LEFT });
    HumanController.update_continuous(state, {});
    cfg.SOUND = "OFF";
    HumanController.handle(state, { type: pg.KEYDOWN, key: pg.K_DOWN });
    expect(tank.power).toBe(999);
    expect(ctx.started).toHaveLength(count);
  });

  it("plays HUD adjustments but ignores AI turns and non-aim phases", () => {
    const { ctx, tank, cfg } = setup();
    const gs = createGameState(cfg, 640, 480, 1);
    gs.current_shooter = tank;
    gs.phase = "aim";
    const state = gs as unknown as ingame.GameState;
    state._hud_hitboxes = { angle: new pg.Rect(150, 4, 80, 20), power: new pg.Rect(6, 4, 80, 20) };
    const angleClick = { type: pg.MOUSEBUTTONDOWN, button: 1, pos: [160, 10] as [number, number] };
    ingame.handle_game_event(state, angleClick);
    ingame.handle_game_event(state, { ...angleClick, pos: [10, 10] });
    expect([tank.angle, tank.power]).toEqual([46, 499]);
    expect(ctx.started).toHaveLength(2);
    ctx.currentTime = 1;
    tank.ai_class = 1;
    ingame.handle_game_event(state, angleClick);
    tank.ai_class = 0;
    gs.phase = "flight";
    ingame.handle_game_event(state, angleClick);
    expect(ctx.started).toHaveLength(2);
  });

  it("plays simultaneous human adjustments without changing their arithmetic", () => {
    const { ctx, tank, cfg } = setup();
    const gs = createGameState(cfg, 640, 480, 1);
    gs.phase = SIM_LIVE;
    gs._sim_human = tank;
    gs._sim_keymap = { ccw: 0, power_up: 1 };
    gs._sim_human_input([true, true], 0.1);
    expect(tank.angle).toBeGreaterThan(45);
    expect(tank.power).toBe(525);
    expect(ctx.started).toHaveLength(2);
    ctx.currentTime = 1;
    gs._sim_human_input([false, false], 0.1);
    expect(ctx.started).toHaveLength(2);
  });

  it("unlocks suspended audio silently and tolerates rejected resume requests", async () => {
    installMock({ state: "suspended" });
    const sound = new Sfx();
    sound.unlock();
    const ctx = ctxOf(sound);
    expect(ctx.resumeCalls).toBe(1);
    expect(ctx.started).toHaveLength(0);
    vi.spyOn(ctx, "resume").mockImplementation(() => Promise.reject(new Error("blocked")));
    expect(() => sound.unlock()).not.toThrow();
    await Promise.resolve();
    vi.spyOn(ctx, "resume").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => sound.unlock()).not.toThrow();
  });

  it("remains safe without an audio device", () => {
    uninstall();
    const sound = new Sfx();
    expect(() => { sound.unlock(); sound.adjustment("angle", 45, 46); }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
describe("sound: init() over a mock AudioContext", () => {
  it("constructs the context and reports usable, honouring its sample rate", () => {
    installMock({ sampleRate: 48000 });
    const s = new Sfx();
    expect(s.init()).toBe(true);
    // second call is idempotent (the _ready short-circuit) and stays true
    expect(s.init()).toBe(true);
    expect((s as unknown as { _mix_rate: number })._mix_rate).toBe(48000);
    expect((s as unknown as { _mix_channels: number })._mix_channels).toBe(2);
  });

  it("falls back to SAMPLE_RATE when the context reports rate 0", () => {
    installMock({ sampleRate: 0 });
    const s = new Sfx();
    expect(s.init()).toBe(true);
    expect((s as unknown as { _mix_rate: number })._mix_rate).toBe(44100);
  });

  it("uses webkitAudioContext when AudioContext is absent", () => {
    uninstall();
    (globalThis as Record<string, unknown>).webkitAudioContext = function () {
      return new MockAudioContext();
    };
    const s = new Sfx();
    expect(s.init()).toBe(true);
  });

  it("a throwing constructor degrades to no-audio and never retries", () => {
    let ctorCalls = 0;
    (globalThis as Record<string, unknown>).AudioContext = function () {
      ctorCalls++;
      throw new Error("no audio device");
    };
    const s = new Sfx();
    expect(s.init()).toBe(false);
    expect(s.init()).toBe(false); // _init_failed short-circuit: no second attempt
    expect(ctorCalls).toBe(1);
    // and every method stays a silent no-op
    expect(s.beep(440, 50)).toBeUndefined();
    expect(s.play("ui_beep")).toBeUndefined();
  });
});

describe("sound: beep() synthesises + plays the oracle-exact buffer", () => {
  it("beep(200,64) buffer == oracle _square_array(200,64), stereo, started", () => {
    installMock();
    const s = new Sfx();
    expect(s.beep(200, 64)).toBeUndefined(); // void no-op contract holds with audio
    const ctx = ctxOf(s);
    expect(ctx.createdBuffers.length).toBe(1);
    expect(ctx.bufferArgs[0]).toEqual({ channels: 2, length: squarePlane(200, 64).length, rate: 44100 });
    expectBufferPlane(ctx.createdBuffers[0], squarePlane(200, 64), "beep 200/64");
    // a source was created, wired to the destination, and started exactly once
    expect(ctx.createdSources.length).toBe(1);
    expect(ctx.createdSources[0].buffer).toBe(ctx.createdBuffers[0]);
    expect(ctx.createdSources[0].connectCount).toBe(1);
    expect(ctx.createdSources[0].startCount).toBe(1);
    expect(ctx.createdSources[0].loop).toBe(false);
  });

  it("caches by (freq,ms): a repeat builds no new buffer but plays a new source", () => {
    installMock();
    const s = new Sfx();
    s.beep(200, 64);
    s.beep(200, 64);
    const ctx = ctxOf(s);
    expect(ctx.createBufferCalls).toBe(1); // cache hit -> no rebuild
    expect(ctx.createdSources.length).toBe(2); // fresh single-use source each shot
  });

  it("clamps freq above MAX down to 12000 before synthesis", () => {
    installMock();
    const s = new Sfx();
    s.beep(99999, 40); // _tone_buffer clamps 99999 -> 12000
    const ctx = ctxOf(s);
    expectBufferPlane(ctx.createdBuffers[0], squarePlane(12000, 40), "beep clamp 99999->12000");
  });

  it("drops sub-19 Hz before touching the context (the a281 clamp)", () => {
    installMock();
    const s = new Sfx();
    expect(s.init()).toBe(true); // materialise the context so we can inspect it
    expect(s.beep(5, 40)).toBeUndefined();
    expect(s.beep(18, 40)).toBeUndefined();
    expect(ctxOf(s).createBufferCalls).toBe(0);
  });

  it("resumes a suspended context before starting, and tolerates a missing resume", () => {
    installMock({ state: "suspended" });
    const s = new Sfx();
    s.beep(200, 64);
    expect(ctxOf(s).resumeCalls).toBe(1);

    installMock({ state: "suspended", noResume: true });
    const s2 = new Sfx();
    expect(() => s2.beep(200, 64)).not.toThrow();
    expect(ctxOf(s2).createdSources[0].startCount).toBe(1);
  });
});

describe("sound: play() event branches build the oracle-exact buffer", () => {
  // (event name, oracle-vector key).  Each play() drives a distinct play()
  // branch; the captured buffer must reproduce the Python plane EXACTLY.
  const EVENTS: Array<[string, string]> = [
    ["fire", "fire"],
    ["plasma", "plasma"],
    ["shield_collapse", "shield_collapse"],
    ["shield_deploy", "shield_deploy"],
    ["death", "death"],
    ["throe_front", "throe_front"], // kill-roulette lead-in (FUN_271b_03b5)
    ["throe_thud", "throe_thud"], // roulette case 0 thud
    ["sink", "sink"], // roulette case 8 falling sweep
    ["battery", "battery"],
    ["dirt_settle", "dirt_settle"],
    ["teleport", "teleport"],
    ["thunder", "thunder"],
    ["shield_hit", "shield_hit"],
    ["parachute", "parachute"],
    ["lightning", "lightning"],
    ["ui_beep", "ui_beep"],
    ["turn", "turn"],
    ["menu_move", "turn"], // aliases -> the 0x14/70 turn tone
    ["select", "turn"],
    ["bounce", "bounce"],
    ["mirv", "mirv"],
    ["fizzle", "fizzle"],
    ["laser", "laser"],
    ["victory", "victory"], // _sweep_buffer clamps 15000 -> 12000 ceiling
    ["dialog_open", "dialog_open"],
    ["dialog_close", "dialog_close"],
  ];
  for (const [name, key] of EVENTS) {
    it(`play("${name}") -> oracle event "${key}" plane (one buffer, one source)`, () => {
      installMock();
      const s = new Sfx();
      expect(s.play(name, true)).toBeUndefined();
      const ctx = ctxOf(s);
      expect(ctx.createdBuffers.length, `${name} buffer count`).toBe(1);
      expectBufferPlane(ctx.createdBuffers[0], vec.events[key].plane, `event ${name}`);
      expect(ctx.createdSources.length, `${name} source count`).toBe(1);
      expect(ctx.createdSources[0].startCount).toBe(1);
    });
  }

  it("explosion size scales the alternation (default / 10 / 100 / nuke / size 0)", () => {
    const cases: Array<[string, boolean, number | undefined, string]> = [
      ["explosion", false, undefined, "explosion"],
      ["explosion", true, 10, "explosion_10"],
      ["explosion", true, 100, "explosion_100"],
      ["nuke", true, undefined, "explosion"], // nuke shares the branch, default size 20
      ["explosion", true, 0, "explosion"], // size 0 -> `|| 20` fallback
    ];
    for (const [name, hasSize, size, key] of cases) {
      installMock();
      const s = new Sfx();
      if (hasSize) s.play(name, true, { size });
      else s.play(name, true);
      const ctx = ctxOf(s);
      expect(ctx.createdBuffers.length, `${name}/${size} buffer count`).toBe(1);
      expectBufferPlane(ctx.createdBuffers[0], vec.events[key].plane, `${name} size=${size}`);
      uninstall();
    }
  });

  it("a gated-off play() touches the context for nothing (even with audio up)", () => {
    installMock();
    const s = new Sfx();
    expect(s.init()).toBe(true);
    expect(s.play("ui_beep", false)).toBeUndefined();
    expect(s.beep(200, 64, false)).toBeUndefined();
    expect(ctxOf(s).createBufferCalls).toBe(0);
  });

  it("an unknown event is a no-op", () => {
    installMock();
    const s = new Sfx();
    expect(s.init()).toBe(true);
    expect(s.play("not_a_real_event", true)).toBeUndefined();
    expect(ctxOf(s).createdBuffers.length).toBe(0);
  });
});

describe("sound: continuous flight-loop (start_fly / fly_tone / stop_fly)", () => {
  it.each([
    { mode: "POS", proj: { sy: 70 } },
    { mode: "VEL", proj: { vx: 30, vy: 40 } },
  ])("keeps $mode flight at 30% gain and one octave lower across updates and shots", ({ mode, proj }) => {
    installMock();
    const s = new Sfx();
    s.start_fly(mode, true);
    const ctx = ctxOf(s);
    const gain = ctx.createdGains[0];
    expect(gain.gain.value).toBe(0.3);
    expect(gain.connections).toEqual([ctx.destination]);
    const seed = flySourceOf(s)!;
    expect(seed.playbackRate.value).toBe(0.5);
    expect(seed.connections).toEqual([gain]);

    s.fly_tone(mode, proj, true);
    const updated = flySourceOf(s)!;
    expect(updated).not.toBe(seed);
    expect(updated.playbackRate.value).toBe(0.5);
    expect(updated.connections).toEqual([gain]);
    s.stop_fly();
    expect(updated.stopCount).toBe(1);
    s.start_fly(mode, true);
    expect(flySourceOf(s)!.playbackRate.value).toBe(0.5);
    expect(flySourceOf(s)!.connections).toEqual([gain]);
    expect(ctx.createdGains).toEqual([gain]);

    s.beep(200, 64, true);
    const beep = ctx.started[ctx.started.length - 1];
    expect(beep.playbackRate.value).toBe(1);
    expect(beep.connections).toEqual([ctx.destination]);
  });

  it("start_fly seeds a looping 300 Hz source == oracle (300,60)", () => {
    installMock();
    const s = new Sfx();
    s.start_fly("VEL", true);
    const ctx = ctxOf(s);
    expect(ctx.createdBuffers.length).toBe(1);
    expectBufferPlane(ctx.createdBuffers[0], squarePlane(300, 60), "fly seed");
    const src = flySourceOf(s);
    expect(src).not.toBeNull();
    expect(src?.loop).toBe(true); // continuous whine, not one-shot
    expect(src?.startCount).toBe(1);
    expect(flyFreqOf(s)).toBe(300);
  });

  it("start_fly is a no-op for OFF and when gated off", () => {
    installMock();
    const a = new Sfx();
    a.start_fly("OFF", true);
    expect(flySourceOf(a)).toBeNull();
    expect(ctxOf(a)?.createdBuffers.length ?? 0).toBe(0);

    installMock();
    const b = new Sfx();
    b.start_fly("VEL", false);
    expect(flySourceOf(b)).toBeNull();
  });

  it("fly_tone(VEL) re-pitches to |v| and swaps the source (oracle 50 Hz buffer)", () => {
    installMock();
    const s = new Sfx();
    s.start_fly("VEL", true); // seed 300
    const seed = flySourceOf(s);
    s.fly_tone("VEL", { vx: 30, vy: 40 }, true); // |v| = 50
    const ctx = ctxOf(s);
    expect(flyFreqOf(s)).toBe(50);
    expectBufferPlane(ctx.createdBuffers[ctx.createdBuffers.length - 1], squarePlane(50, 60), "fly swap 50");
    expect(seed?.stopCount).toBe(1); // old single-use source stopped
    const cur = flySourceOf(s);
    expect(cur).not.toBe(seed);
    expect(cur?.loop).toBe(true);
  });

  it("fly_tone(POS) uses (launch_y - y)*8 + 1000, floored at 50, via set_launch_y", () => {
    installMock();
    const s = new Sfx();
    s.start_fly("POS", true); // seed 300
    s.set_launch_y(0);
    s.fly_tone("POS", { sy: 70 }, true); // (0-70)*8+1000 = 440
    expect(flyFreqOf(s)).toBe(440);
    const ctx = ctxOf(s);
    expectBufferPlane(ctx.createdBuffers[ctx.createdBuffers.length - 1], squarePlane(440, 60), "fly POS 440");
  });

  it("fly_tone clamps |v| above MAX to the 12000 ceiling", () => {
    installMock();
    const s = new Sfx();
    s.start_fly("VEL", true);
    s.fly_tone("VEL", { vx: 9000, vy: 9000 }, true); // hypot 12727 -> clamp 12000
    expect(flyFreqOf(s)).toBe(12000);
    const ctx = ctxOf(s);
    expectBufferPlane(ctx.createdBuffers[ctx.createdBuffers.length - 1], squarePlane(12000, 60), "fly clamp 12000");
  });

  it("fly_tone does not rebuild when the integer pitch is unchanged", () => {
    installMock();
    const s = new Sfx();
    s.start_fly("VEL", true); // seed 300
    s.fly_tone("VEL", { vx: 300, vy: 0 }, true); // |v| = 300 == current
    const ctx = ctxOf(s);
    expect(ctx.createBufferCalls).toBe(1); // only the seed buffer
    expect(ctx.createdSources.length).toBe(1); // no swap
    expect(flyFreqOf(s)).toBe(300);
  });

  it("fly_tone lazily starts the loop when none is running", () => {
    installMock();
    const s = new Sfx();
    s.fly_tone("VEL", { vx: 30, vy: 40 }, true); // no prior start_fly
    expect(flySourceOf(s)).not.toBeNull();
    expect(flyFreqOf(s)).toBe(50); // seeded then immediately re-pitched
  });

  it("fly_tone(OFF) and an explicit gated-off call stop the loop", () => {
    installMock();
    const s = new Sfx();
    s.start_fly("VEL", true);
    const src = flySourceOf(s);
    s.fly_tone("OFF", {}, true);
    expect(src?.stopCount).toBe(1);
    expect(flySourceOf(s)).toBeNull();
    expect(flyFreqOf(s)).toBe(0);

    installMock();
    const s2 = new Sfx();
    s2.start_fly("VEL", true);
    const src2 = flySourceOf(s2);
    s2.fly_tone("VEL", { vx: 30, vy: 40 }, false); // gated off -> stop
    expect(src2?.stopCount).toBe(1);
    expect(flySourceOf(s2)).toBeNull();
  });

  it("stop_fly is idempotent and tolerant of an already-stopped source", () => {
    installMock();
    const s = new Sfx();
    s.start_fly("VEL", true);
    const src = flySourceOf(s);
    if (src !== null) src.failStop = true; // simulate "already stopped" throwing
    expect(() => s.stop_fly()).not.toThrow();
    expect(flySourceOf(s)).toBeNull();
    expect(() => s.stop_fly()).not.toThrow(); // second call: nothing playing
  });
});

describe("sound: degradation when the context throws (never raises)", () => {
  it("a failing flight gain is silent and can be retried", () => {
    installMock();
    const s = new Sfx();
    expect(s.init()).toBe(true);
    const ctx = ctxOf(s);
    ctx.failCreateGain = true;
    expect(() => s.start_fly("VEL", true)).not.toThrow();
    expect(flySourceOf(s)).toBeNull();
    expect(ctx.started.length).toBe(0);
    ctx.failCreateGain = false;
    s.start_fly("VEL", true);
    expect(flySourceOf(s)).not.toBeNull();
    expect(ctx.createdGains[0].gain.value).toBe(0.3);
  });

  it("a failing createBuffer yields no buffer, no source, no throw", () => {
    installMock();
    const s = new Sfx();
    expect(s.init()).toBe(true);
    ctxOf(s).failCreateBuffer = true;
    expect(() => s.beep(200, 64)).not.toThrow();
    const ctx = ctxOf(s);
    expect(ctx.createBufferCalls).toBe(1); // attempted
    expect(ctx.createdBuffers.length).toBe(0); // threw before storing
    expect(ctx.createdSources.length).toBe(0); // _play_buffer(null) -> nothing
  });

  it("a failing createBufferSource yields no started source, no throw", () => {
    installMock();
    const s = new Sfx();
    expect(s.init()).toBe(true);
    ctxOf(s).failCreateSource = true;
    expect(() => s.beep(200, 64)).not.toThrow();
    expect(ctxOf(s).started.length).toBe(0);
  });

  it("a failing source.start() during a one-shot is swallowed", () => {
    installMock();
    const s = new Sfx();
    expect(s.init()).toBe(true);
    ctxOf(s).failNextStart = true;
    expect(() => s.beep(200, 64)).not.toThrow();
    expect(ctxOf(s).started.length).toBe(0);
  });

  it("a failing start() in start_fly leaves no flight source", () => {
    installMock();
    const s = new Sfx();
    expect(s.init()).toBe(true);
    ctxOf(s).failNextStart = true;
    expect(() => s.start_fly("VEL", true)).not.toThrow();
    expect(flySourceOf(s)).toBeNull();
  });

  it("a swap whose old.stop() throws still re-pitches", () => {
    installMock();
    const s = new Sfx();
    s.start_fly("VEL", true); // seed 300
    const seed = flySourceOf(s);
    if (seed !== null) seed.failStop = true; // old source throws on stop
    s.fly_tone("VEL", { vx: 30, vy: 40 }, true); // -> 50, must still swap
    expect(flyFreqOf(s)).toBe(50);
    expect(flySourceOf(s)).not.toBe(seed);
  });

  it("a swap whose new source cannot be created keeps the previous one", () => {
    installMock();
    const s = new Sfx();
    s.start_fly("VEL", true); // seed 300
    ctxOf(s).failCreateSource = true; // the swap's createBufferSource will throw
    s.fly_tone("VEL", { vx: 30, vy: 40 }, true); // attempt -> 50
    expect(flyFreqOf(s)).toBe(300); // unchanged: previous source retained
  });
});

describe("sound: branch mop-up (nullish defaults, mode defaults, sweep/seq degradation)", () => {
  it("_fly_freq_for defaults a missing proj field to 0 (POS) / 0.0 (VEL)", () => {
    const s = new Sfx();
    s.set_launch_y(0);
    // POS with no sy: sy ?? 0 -> 0; (0-0)*8+1000 = 1000 (== oracle POS launch=0/sy=0)
    expect(s._fly_freq_for("POS", {})).toBe(1000);
    // VEL with no vx/vy: hypot(0,0)=0 -> clamp floor 19 (== oracle VEL 0,0)
    expect(s._fly_freq_for("VEL", {})).toBe(19);
  });

  it("start_fly() with no mode falls back to fly_mode; an empty mode is OFF", () => {
    installMock();
    const a = new Sfx();
    a.fly_mode = "VEL";
    a.start_fly(); // mode undefined -> uses this.fly_mode
    expect(a.fly_mode).toBe("VEL");
    expect(flySourceOf(a)).not.toBeNull();
    expect(flyFreqOf(a)).toBe(300);

    installMock();
    const b = new Sfx();
    b.start_fly(""); // "" || "OFF" -> OFF -> no-op
    expect(b.fly_mode).toBe("OFF");
    expect(flySourceOf(b)).toBeNull();
  });

  it("fly_tone() with an empty mode stops the loop", () => {
    installMock();
    const s = new Sfx();
    s.start_fly("VEL", true);
    const src = flySourceOf(s);
    s.fly_tone("", { vx: 10, vy: 10 }, true); // "" -> OFF -> stop
    expect(src?.stopCount).toBe(1);
    expect(flySourceOf(s)).toBeNull();
  });

  it("start_fly whose seed buffer cannot be built leaves no source", () => {
    installMock();
    const s = new Sfx();
    expect(s.init()).toBe(true);
    ctxOf(s).failCreateBuffer = true; // _tone_buffer(300,60) -> null
    expect(() => s.start_fly("VEL", true)).not.toThrow();
    expect(flySourceOf(s)).toBeNull();
  });

  it("fly_tone whose lazy start cannot build a source returns without a loop", () => {
    installMock();
    const s = new Sfx();
    expect(s.init()).toBe(true);
    ctxOf(s).failCreateBuffer = true; // start_fly seed fails -> _fly_source stays null
    expect(() => s.fly_tone("VEL", { vx: 10, vy: 10 }, true)).not.toThrow();
    expect(flySourceOf(s)).toBeNull();
  });

  it("a sweep event whose buffer fails to build is a silent no-op", () => {
    installMock();
    const s = new Sfx();
    expect(s.init()).toBe(true);
    ctxOf(s).failCreateBuffer = true; // _sweep_buffer -> _buffer null -> null
    expect(() => s.play("laser", true)).not.toThrow();
    expect(ctxOf(s).started.length).toBe(0);
  });

  it("a sequence event whose buffer fails to build is a silent no-op", () => {
    installMock();
    const s = new Sfx();
    expect(s.init()).toBe(true);
    ctxOf(s).failCreateBuffer = true; // _seq_buffer -> _buffer null -> null
    expect(() => s.play("fire", true)).not.toThrow();
    expect(ctxOf(s).started.length).toBe(0);
  });
});

describe("sound: low sample-rate fade clamp (_linspace num==1) vs oracle", () => {
  // fade = max(1, trunc(rate*0.003)) pins to 1 below ~667 Hz, driving
  // _linspace(.,.,1).  No real AudioContext opens this low; the oracle dumps
  // these from a _Sfx with _mix_rate=600 and the TS sets the same rate.
  for (let i = 0; i < vec.lowrate.length; i++) {
    const c = vec.lowrate[i];
    it(`#${i} ${c.freq}Hz ${c.ms}ms @ ${c.rate}Hz (n=${c.n})`, () => {
      const s = new Sfx();
      (s as unknown as { _mix_rate: number })._mix_rate = c.rate;
      const got = s._square_array(c.freq, c.ms);
      expect(got.length, `lowrate #${i} length`).toBe(c.plane.length);
      for (let k = 0; k < c.plane.length; k++) {
        if (got[k] !== c.plane[k]) expect(got[k], `lowrate #${i} sample[${k}]`).toBe(c.plane[k]);
      }
    });
  }
});
