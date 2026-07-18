export type ColumnId = "dj" | "genre" | "popularity" | "plays";
export type NativeColumnKey = "artist" | "album" | "dateAdded";
export type SortColumn = ColumnId | NativeColumnKey | "title" | "duration";
export type SortDirection = "asc" | "desc";

export interface SortState {
  column: SortColumn;
  direction: SortDirection;
}

export interface PtcSettings {
  columns: Record<ColumnId, boolean>;
  native: Record<NativeColumnKey, boolean>;
  dj: { camelot: boolean; showBpm: boolean };
  defaultSort: { column: SortColumn | null; direction: SortDirection };
}

export interface TrackMeta {
  uri: string;
  id?: string;
  title: string;
  artist: string;
  album: string;
  popularity: number | null;
  plays: number | null;
  genres: string[];
  djKey?: string | null;
  djBpm?: number | null;
  durationMs?: number;
  dateAddedMs?: number;
  complete?: boolean;
}

export interface SpotifyTrack {
  id: string;
  uri: string;
  name: string;
  popularity?: number;
  duration_ms?: number;
  artists?: { id: string; name: string }[];
  album?: { name: string };
}

export interface SpotifyArtist {
  id: string;
  genres?: string[];
}
