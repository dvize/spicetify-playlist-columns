import { debugLog } from "./debug";
import { logSortTrace, mismatchInfo, summarizeUidOrder } from "./sort-debug";
import type { SortColumn, SortDirection, TrackMeta } from "./types";

export interface PlaylistTrackItem {
  uri?: string;
  uid?: string;
  addedAt?: string;
}

const ORIGINAL_ORDER_PREFIX = "ptc:original-uris:";

export type CanReorderReason = "ok" | "editorial" | "no_edit_permission" | "metadata_error" | "not_playlist";

export interface CanReorderResult {
  allowed: boolean;
  reason: CanReorderReason;
  editorial?: boolean;
  canEditItems?: boolean | null;
  isOwner?: boolean;
  rawKeys?: string[];
}

export function isReorderablePlaylist(uri: string) {
  return Spicetify.URI.isPlaylistV1OrV2(uri);
}

export function isEditorialPlaylistUri(uri: string) {
  return /spotify:playlist:37i9dQZF1/i.test(uri);
}

function extractCanEditItems(meta: unknown): boolean | null {
  if (!meta || typeof meta !== "object") return null;
  const m = meta as Record<string, unknown>;
  const candidates = [
    (m.capabilities as Record<string, unknown> | undefined)?.canEditItems,
    (m.permissions as Record<string, unknown> | undefined)?.canEditItems,
    (m.userCapabilities as Record<string, unknown> | undefined)?.canEditItems,
    m.canEditItems,
  ];
  for (const v of candidates) {
    if (typeof v === "boolean") return v;
  }
  return null;
}

export async function canReorderPlaylist(uri: string): Promise<CanReorderResult> {
  if (!isReorderablePlaylist(uri)) {
    return { allowed: false, reason: "not_playlist" };
  }

  const editorial = isEditorialPlaylistUri(uri);
  if (editorial) {
    logSortTrace("capabilities", { uri, editorial: true, canEditItems: false, reason: "editorial" });
    return { allowed: false, reason: "editorial", editorial: true, canEditItems: false };
  }

  try {
    const meta = await Spicetify.Platform.PlaylistAPI.getMetadata(uri);
    const canEditItems = extractCanEditItems(meta);
    const record = meta as { isOwnedBySelf?: boolean; isOwner?: boolean } | null;
    const isOwner = Boolean(record?.isOwnedBySelf ?? record?.isOwner);
    const rawKeys = meta && typeof meta === "object" ? Object.keys(meta as object).slice(0, 30) : [];

    logSortTrace("capabilities", { uri, editorial: false, canEditItems, isOwner, rawKeys });

    if (canEditItems === true) {
      return { allowed: true, reason: "ok", editorial: false, canEditItems, isOwner, rawKeys };
    }
    if (canEditItems === false) {
      return { allowed: false, reason: "no_edit_permission", editorial: false, canEditItems, isOwner, rawKeys };
    }
    return { allowed: false, reason: "metadata_error", editorial: false, canEditItems: null, isOwner, rawKeys };
  } catch (e) {
    logSortTrace("capabilities.error", { uri, error: String(e) });
    return { allowed: false, reason: "metadata_error", editorial: false };
  }
}

export function getOriginalOrderStorageKey(uri: string) {
  return `${ORIGINAL_ORDER_PREFIX}${uri}`;
}

export function snapshotOriginalOrder(uri: string, items: PlaylistTrackItem[]) {
  const key = getOriginalOrderStorageKey(uri);
  if (sessionStorage.getItem(key)) return;
  const uris = getUriOrder(items);
  if (!uris.length) return;
  sessionStorage.setItem(key, JSON.stringify(uris));
}

export function loadOriginalOrder(uri: string): string[] | null {
  try {
    const raw = sessionStorage.getItem(getOriginalOrderStorageKey(uri));
    return raw ? (JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

export function clearOriginalOrder(uri: string) {
  sessionStorage.removeItem(getOriginalOrderStorageKey(uri));
}

export function getUidOrder(items: PlaylistTrackItem[]): string[] {
  return items.map((i) => i.uid).filter((u): u is string => Boolean(u));
}

export function getUriOrder(items: PlaylistTrackItem[]): string[] {
  return items.map((i) => i.uri).filter((u): u is string => Boolean(u));
}

export function uidsMatchOrder(items: PlaylistTrackItem[], targetUids: string[]) {
  const current = getUidOrder(items);
  if (current.length !== targetUids.length) return false;
  return current.every((uid, i) => uid === targetUids[i]);
}

export function urisMatchOrder(items: PlaylistTrackItem[], targetUris: string[]) {
  const current = getUriOrder(items);
  if (current.length !== targetUris.length) return false;
  return current.every((uri, i) => uri === targetUris[i]);
}

export function orderItemsByUids(items: PlaylistTrackItem[], uids: string[]): PlaylistTrackItem[] {
  const byUid = new Map(items.filter((i) => i.uid).map((i) => [i.uid!, i]));
  const ordered: PlaylistTrackItem[] = [];
  const seen = new Set<string>();

  for (const uid of uids) {
    const item = byUid.get(uid);
    if (item) {
      ordered.push(item);
      seen.add(uid);
    }
  }

  for (const item of items) {
    if (item.uid && !seen.has(item.uid)) ordered.push(item);
  }

  return ordered;
}

export function orderItemsByUris(items: PlaylistTrackItem[], uris: string[]): PlaylistTrackItem[] {
  const byUri = new Map<string, PlaylistTrackItem[]>();
  for (const item of items) {
    if (!item.uri) continue;
    const list = byUri.get(item.uri) || [];
    list.push(item);
    byUri.set(item.uri, list);
  }

  const ordered: PlaylistTrackItem[] = [];
  for (const uri of uris) {
    const list = byUri.get(uri);
    if (list?.length) ordered.push(list.shift()!);
  }
  for (const list of byUri.values()) ordered.push(...list);
  return ordered;
}

const ADD_BATCH_SIZE = 100;

async function clearPlaylistContents(playlistUri: string, current: PlaylistTrackItem[]) {
  const api = Spicetify.Platform.PlaylistAPI as {
    clear?: (uri: string) => Promise<void>;
    remove?: (uri: string, rows: { uri: string; uid: string }[]) => Promise<void>;
  };

  logSortTrace("reorder.clear.start", { playlistUri, trackCount: current.length });
  const t0 = Date.now();

  if (typeof api.clear === "function") {
    await api.clear(playlistUri);
    logSortTrace("reorder.clear.ok", { method: "clear", durationMs: Date.now() - t0 });
    return;
  }

  if (typeof api.remove !== "function") {
    throw new Error("PlaylistAPI.clear/remove unavailable");
  }

  const rows = current
    .filter((i) => i.uid && i.uri)
    .map((i) => ({ uri: i.uri!, uid: i.uid! }));
  if (!rows.length) {
    logSortTrace("reorder.clear.ok", { method: "noop", durationMs: Date.now() - t0 });
    return;
  }

  for (let i = 0; i < rows.length; i += ADD_BATCH_SIZE) {
    await api.remove(playlistUri, rows.slice(i, i + ADD_BATCH_SIZE));
  }
  logSortTrace("reorder.clear.ok", { method: "remove", rowCount: rows.length, durationMs: Date.now() - t0 });
}

async function addPlaylistTracks(playlistUri: string, trackUris: string[]) {
  const api = Spicetify.Platform.PlaylistAPI as {
    add: (uri: string, uris: string[], position?: { after?: string }) => Promise<void>;
  };

  logSortTrace("reorder.add.start", { playlistUri, trackCount: trackUris.length });
  const t0 = Date.now();
  for (let i = 0; i < trackUris.length; i += ADD_BATCH_SIZE) {
    const batch = trackUris.slice(i, i + ADD_BATCH_SIZE);
    await api.add(playlistUri, batch, { after: "end" });
    logSortTrace("reorder.add.batch", { offset: i, batchSize: batch.length });
  }
  logSortTrace("reorder.add.ok", { trackCount: trackUris.length, durationMs: Date.now() - t0 });
}

/** Reorder by clearing playlist contents and re-adding tracks in target order (new UIDs). */
export async function reorderPlaylistByUids(playlistUri: string, sortedItems: PlaylistTrackItem[]) {
  const movable = sortedItems.filter((i) => i.uri);
  if (movable.length < 2) {
    logSortTrace("reorder.skip", { reason: "too_few_tracks", count: movable.length });
    return;
  }

  const targetUris = getUriOrder(movable);
  const current = await fetchPlaylistItems(playlistUri);
  const currentUris = getUriOrder(current);
  logSortTrace("reorder.preflight", {
    playlistUri,
    trackCount: movable.length,
    currentUris: summarizeUidOrder(currentUris),
    targetUris: summarizeUidOrder(targetUris),
    matches: urisMatchOrder(current, targetUris),
  });

  if (urisMatchOrder(current, targetUris)) {
    debugLog("reorder skipped: order already matches");
    logSortTrace("reorder.skip", { reason: "already_matches" });
    return;
  }

  logSortTrace("reorder.replace.start", { trackCount: movable.length });
  const moveT0 = Date.now();

  await clearPlaylistContents(playlistUri, current);
  await addPlaylistTracks(playlistUri, targetUris);

  const moveDurationMs = Date.now() - moveT0;
  const postItems = await fetchPlaylistItems(playlistUri);
  const postUris = getUriOrder(postItems);
  logSortTrace("reorder.post_move", {
    playlistUri,
    moveDurationMs,
    movedCount: movable.length,
    ...mismatchInfo(postUris, targetUris),
  });

  debugLog(`reordered ${movable.length} tracks via clear+re-add`);
  logSortTrace("reorder.replace.done", { trackCount: movable.length, moveDurationMs });
}

export const MOVE_SETTLE_MS = 400;

export async function settleAfterMove(ms = MOVE_SETTLE_MS) {
  await new Promise((r) => setTimeout(r, ms));
}

export async function fetchPlaylistItems(playlistUri: string): Promise<PlaylistTrackItem[]> {
  const res = await Spicetify.Platform.PlaylistAPI.getContents(playlistUri);
  const items = (res?.items || []) as PlaylistTrackItem[];
  return items.filter((i) => i.uri?.startsWith("spotify:track:") || i.uri?.startsWith("spotify:local:"));
}

export async function verifyPlaylistOrder(playlistUri: string, targetUris: string[]) {
  const items = await fetchPlaylistItems(playlistUri);
  const currentUris = getUriOrder(items);
  const ok = urisMatchOrder(items, targetUris);
  if (!ok) {
    logSortTrace("verify.mismatch", {
      playlistUri,
      ...mismatchInfo(currentUris, targetUris),
    });
  }
  return ok;
}

export async function verifyPlaylistOrderWithRetry(
  playlistUri: string,
  targetUris: string[],
  opts?: { attempts?: number; delayMs?: number }
) {
  const attempts = opts?.attempts ?? 3;
  const delayMs = opts?.delayMs ?? 300;

  logSortTrace("verify.start", { playlistUri, attempts, delayMs, targetLen: targetUris.length });

  for (let i = 0; i < attempts; i++) {
    const items = await fetchPlaylistItems(playlistUri);
    const currentUris = getUriOrder(items);
    const ok = urisMatchOrder(items, targetUris);
    logSortTrace("verify.attempt", {
      attempt: i + 1,
      ok,
      ...mismatchInfo(currentUris, targetUris),
    });
    if (ok) {
      logSortTrace("verify.ok", { attempt: i + 1 });
      return true;
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }

  logSortTrace("verify.failed", { attempts });
  return false;
}

export function sortPlaylistItems(
  items: PlaylistTrackItem[],
  column: SortColumn,
  direction: SortDirection,
  getSortValue: (meta: TrackMeta | undefined, column: SortColumn, item?: PlaylistTrackItem) => string | number | null,
  cache: Map<string, TrackMeta>
) {
  return [...items].sort((a, b) => {
    const metaA = a.uri ? cache.get(a.uri) : undefined;
    const metaB = b.uri ? cache.get(b.uri) : undefined;
    let va = getSortValue(metaA, column, a);
    let vb = getSortValue(metaB, column, b);
    if (va == null) va = "";
    if (vb == null) vb = "";
    let cmp = 0;
    if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
    else cmp = String(va).localeCompare(String(vb));
    return direction === "asc" ? cmp : -cmp;
  });
}
