import type { ColumnId, NativeColumnKey, PtcSettings, SortColumn, SortState } from "./types";

export const SETTINGS_KEY = "ptc:settings";
export const SORT_KEY_PREFIX = "ptc:sort:";

export const CUSTOM_COLUMNS: { id: ColumnId; label: string }[] = [
  { id: "dj", label: "DJ" },
  { id: "genre", label: "Genre" },
  { id: "popularity", label: "Popularity" },
  { id: "plays", label: "Plays" },
];

export const NATIVE_COLUMN_MAP: Record<NativeColumnKey, string[]> = {
  artist: ["artist", "artists"],
  album: ["album"],
  dateAdded: ["date added", "added", "date add"],
};

export const DEFAULT_SETTINGS: PtcSettings = {
  columns: { dj: true, genre: true, popularity: true, plays: true },
  native: { artist: true, album: true, dateAdded: true },
  dj: { camelot: true, showBpm: true },
  defaultSort: { column: null, direction: "desc" },
};

export const SORT_LABELS: Record<SortColumn, string> = {
  dj: "DJ",
  genre: "Genre",
  popularity: "Popularity",
  plays: "Plays",
  title: "Title",
  artist: "Artist",
  album: "Album",
  duration: "Duration",
  dateAdded: "Date added",
};

export function getSortStorageKey(uri: string) {
  return `${SORT_KEY_PREFIX}${uri}`;
}

export function loadSortForUri(uri: string): SortState | null {
  try {
    const raw = sessionStorage.getItem(getSortStorageKey(uri));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSortForUri(uri: string, sort: SortState | null) {
  if (!sort?.column) {
    sessionStorage.removeItem(getSortStorageKey(uri));
    return;
  }
  sessionStorage.setItem(getSortStorageKey(uri), JSON.stringify(sort));
}

