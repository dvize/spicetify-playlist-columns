import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SortColumn, TrackMeta } from "./types";
import {
  canReorderPlaylist,
  getUidOrder,
  isEditorialPlaylistUri,
  orderItemsByUids,
  reorderPlaylistByUids,
  sortPlaylistItems,
  uidsMatchOrder,
  type PlaylistTrackItem,
} from "./playlist-sort";

const PLAYLIST_URI = "spotify:playlist:test123";

function item(uid: string, uri: string): PlaylistTrackItem {
  return { uid, uri };
}

function meta(uri: string, popularity: number | null, genres: string[] = []): TrackMeta {
  return {
    uri,
    title: uri,
    artist: "",
    album: "",
    popularity,
    plays: null,
    genres,
    complete: true,
  };
}

function sortValue(m: TrackMeta | undefined, column: SortColumn) {
  if (column === "popularity") return m?.popularity ?? -1;
  if (column === "genre") return (m?.genres || []).join(", ").toLowerCase();
  return "";
}

describe("uidsMatchOrder", () => {
  it("matches identical uid sequences", () => {
    const items = [item("u1", "spotify:track:1"), item("u2", "spotify:track:2")];
    expect(uidsMatchOrder(items, ["u1", "u2"])).toBe(true);
  });

  it("rejects mismatched order", () => {
    const items = [item("u2", "spotify:track:2"), item("u1", "spotify:track:1")];
    expect(uidsMatchOrder(items, ["u1", "u2"])).toBe(false);
  });
});

describe("orderItemsByUids", () => {
  it("reorders items by uid list", () => {
    const items = [item("a", "spotify:track:a"), item("b", "spotify:track:b"), item("c", "spotify:track:c")];
    const ordered = orderItemsByUids(items, ["c", "a"]);
    expect(getUidOrder(ordered)).toEqual(["c", "a", "b"]);
  });
});

describe("sortPlaylistItems", () => {
  const cache = new Map<string, TrackMeta>([
    ["spotify:track:low", meta("spotify:track:low", 10)],
    ["spotify:track:high", meta("spotify:track:high", 90)],
    ["spotify:track:null", meta("spotify:track:null", null)],
  ]);

  const items: PlaylistTrackItem[] = [
    { uri: "spotify:track:low", uid: "u-low" },
    { uri: "spotify:track:high", uid: "u-high" },
    { uri: "spotify:track:null", uid: "u-null" },
  ];

  it("sorts popularity descending", () => {
    const sorted = sortPlaylistItems(items, "popularity", "desc", sortValue, cache);
    expect(sorted.map((i) => i.uri)).toEqual([
      "spotify:track:high",
      "spotify:track:low",
      "spotify:track:null",
    ]);
  });

  it("sorts popularity ascending", () => {
    const sorted = sortPlaylistItems(items, "popularity", "asc", sortValue, cache);
    expect(sorted.map((i) => i.uri)).toEqual([
      "spotify:track:null",
      "spotify:track:low",
      "spotify:track:high",
    ]);
  });

  it("sorts genre alphabetically", () => {
    const genreCache = new Map<string, TrackMeta>([
      ["spotify:track:a", meta("spotify:track:a", 1, ["House"])],
      ["spotify:track:b", meta("spotify:track:b", 1, ["Edm, Dance"])],
    ]);
    const genreItems: PlaylistTrackItem[] = [
      { uri: "spotify:track:a", uid: "a" },
      { uri: "spotify:track:b", uid: "b" },
    ];
    const sorted = sortPlaylistItems(genreItems, "genre", "asc", sortValue, genreCache);
    expect(sorted.map((i) => i.uid)).toEqual(["b", "a"]);
  });
});

describe("canReorderPlaylist", () => {
  const getMetadata = vi.fn();

  beforeEach(() => {
    getMetadata.mockReset();
    (globalThis as { Spicetify?: Record<string, unknown> }).Spicetify = {
      Platform: {
        PlaylistAPI: { getMetadata, move: vi.fn(), getContents: vi.fn() },
      },
      URI: { isPlaylistV1OrV2: (uri: string) => uri.startsWith("spotify:playlist:") },
    };
  });

  it("detects editorial playlist URIs", () => {
    expect(isEditorialPlaylistUri("spotify:playlist:37i9dQZF1DWWOGXILUAh53")).toBe(true);
    expect(isEditorialPlaylistUri("spotify:playlist:abc123")).toBe(false);
  });

  it("rejects editorial without getMetadata", async () => {
    const result = await canReorderPlaylist("spotify:playlist:37i9dQZF1DWWOGXILUAh53");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("editorial");
    expect(getMetadata).not.toHaveBeenCalled();
  });

  it("rejects when canEditItems is false", async () => {
    getMetadata.mockResolvedValue({ capabilities: { canEditItems: false } });
    const result = await canReorderPlaylist("spotify:playlist:owned123");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("no_edit_permission");
  });

  it("allows when canEditItems is true", async () => {
    getMetadata.mockResolvedValue({ capabilities: { canEditItems: true }, isOwnedBySelf: true });
    const result = await canReorderPlaylist("spotify:playlist:owned123");
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("ok");
  });
});

describe("reorderPlaylistByUids", () => {
  const move = vi.fn();
  const getContents = vi.fn();

  beforeEach(() => {
    move.mockReset().mockResolvedValue(undefined);
    getContents.mockReset();
    (globalThis as { Spicetify?: Record<string, unknown> }).Spicetify = {
      Platform: {
        PlaylistAPI: { move, getContents },
      },
      URI: { isPlaylistV1OrV2: () => true },
    };
  });

  it("calls move once per track in reverse order before start when order differs", async () => {
    const sorted: PlaylistTrackItem[] = [
      item("u1", "spotify:track:1"),
      item("u2", "spotify:track:2"),
      item("u3", "spotify:track:3"),
    ];
    getContents.mockResolvedValue({
      items: [sorted[2], sorted[0], sorted[1]],
    });

    await reorderPlaylistByUids(PLAYLIST_URI, sorted);

    expect(move).toHaveBeenCalledTimes(3);
    expect(getContents).toHaveBeenCalledTimes(2);
    expect(move).toHaveBeenNthCalledWith(
      1,
      PLAYLIST_URI,
      [{ uri: "spotify:track:3", uid: "u3" }],
      { before: "start" }
    );
    expect(move).toHaveBeenNthCalledWith(
      2,
      PLAYLIST_URI,
      [{ uri: "spotify:track:2", uid: "u2" }],
      { before: "start" }
    );
    expect(move).toHaveBeenNthCalledWith(
      3,
      PLAYLIST_URI,
      [{ uri: "spotify:track:1", uid: "u1" }],
      { before: "start" }
    );
  });

  it("still moves every track when a mid-list UID already matches its target index", async () => {
    const sorted: PlaylistTrackItem[] = [
      item("u1", "spotify:track:1"),
      item("u2", "spotify:track:2"),
      item("u3", "spotify:track:3"),
    ];
    // u2 is already at index 1 in both current and target — old skip logic wrongly skipped it
    getContents.mockResolvedValue({
      items: [sorted[2], sorted[1], sorted[0]],
    });

    await reorderPlaylistByUids(PLAYLIST_URI, sorted);

    expect(move).toHaveBeenCalledTimes(3);
    expect(getContents).toHaveBeenCalledTimes(2);
    expect(move).toHaveBeenNthCalledWith(
      1,
      PLAYLIST_URI,
      [{ uri: "spotify:track:3", uid: "u3" }],
      { before: "start" }
    );
    expect(move).toHaveBeenNthCalledWith(
      2,
      PLAYLIST_URI,
      [{ uri: "spotify:track:2", uid: "u2" }],
      { before: "start" }
    );
    expect(move).toHaveBeenNthCalledWith(
      3,
      PLAYLIST_URI,
      [{ uri: "spotify:track:1", uid: "u1" }],
      { before: "start" }
    );
  });

  it("skips move when playlist already matches target order", async () => {
    const sorted: PlaylistTrackItem[] = [
      item("u1", "spotify:track:1"),
      item("u2", "spotify:track:2"),
    ];
    getContents.mockResolvedValue({ items: sorted });

    await reorderPlaylistByUids(PLAYLIST_URI, sorted);

    expect(move).not.toHaveBeenCalled();
  });
});
