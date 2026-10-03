/** Browser-only preference: never included in match configuration or saves. */
import { sfx } from "./sound";

export const VOLUME_STORAGE_KEY = "scorched.volume";

export function loadVolumePreference(): void {
  let percent = 100;
  try {
    const stored = localStorage.getItem(VOLUME_STORAGE_KEY);
    if (stored !== null && stored.trim() !== "" && Number.isFinite(Number(stored))) {
      percent = Math.round(Math.max(0, Math.min(100, Number(stored))));
    }
  } catch {
    // Storage can be unavailable; audio still works for this visit.
  }
  sfx.volume = percent / 100;
}

export function saveVolumePreference(percent: number): void {
  if (!Number.isFinite(percent)) return;
  percent = Math.round(Math.max(0, Math.min(100, percent)));
  sfx.volume = percent / 100;
  try {
    localStorage.setItem(VOLUME_STORAGE_KEY, String(percent));
  } catch {
    // Keep the live volume even if this browser cannot save preferences.
  }
}
