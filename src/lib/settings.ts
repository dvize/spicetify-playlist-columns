import { DEFAULT_SETTINGS, SETTINGS_KEY } from "./constants";
import type { PtcSettings } from "./types";

let settings: PtcSettings = loadSettings();

export function getSettings() {
  return settings;
}

export function loadSettings(): PtcSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<PtcSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      columns: { ...DEFAULT_SETTINGS.columns, ...parsed.columns },
      native: { ...DEFAULT_SETTINGS.native, ...parsed.native },
      dj: { ...DEFAULT_SETTINGS.dj, ...parsed.dj },
      defaultSort: { ...DEFAULT_SETTINGS.defaultSort, ...parsed.defaultSort },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(next: PtcSettings) {
  settings = next;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function reloadSettings() {
  settings = loadSettings();
}
