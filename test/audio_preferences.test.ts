import { afterEach, describe, expect, it, vi } from "vitest";
import { loadVolumePreference, saveVolumePreference, VOLUME_STORAGE_KEY } from "../src/audio_preferences";
import { sfx } from "../src/sound";

afterEach(() => {
  vi.unstubAllGlobals();
  sfx.volume = 1;
});

describe("browser volume preference", () => {
  it.each([
    [null, 1], ["", 1], ["  ", 1], ["invalid", 1], ["NaN", 1], ["Infinity", 1],
    ["0", 0], ["35", 0.35], ["-20", 0], ["120", 1], ["35.7", 0.36],
  ])("loads %s as %s", (stored, expected) => {
    const getItem = vi.fn(() => stored);
    vi.stubGlobal("localStorage", { getItem });
    loadVolumePreference();
    expect(getItem).toHaveBeenCalledWith(VOLUME_STORAGE_KEY);
    expect(sfx.volume).toBe(expected);
  });

  it("applies and remembers a percentage without a config save", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    saveVolumePreference(27);
    expect(sfx.volume).toBe(0.27);
    expect(values.get(VOLUME_STORAGE_KEY)).toBe("27");
    sfx.volume = 1;
    loadVolumePreference();
    expect(sfx.volume).toBe(0.27);
  });

  it("retains live volume when storage operations fail", () => {
    const blocked = () => { throw new Error("Storage blocked"); };
    vi.stubGlobal("localStorage", { getItem: blocked, setItem: blocked });
    expect(() => loadVolumePreference()).not.toThrow();
    expect(sfx.volume).toBe(1);
    expect(() => saveVolumePreference(15)).not.toThrow();
    expect(sfx.volume).toBe(0.15);
  });

  it("works without browser storage", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => loadVolumePreference()).not.toThrow();
    expect(() => saveVolumePreference(0)).not.toThrow();
    expect(sfx.volume).toBe(0);
  });
});
