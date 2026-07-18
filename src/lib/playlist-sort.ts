import { debugLog } from "./debug";
import { logSortTrace, mismatchInfo, summarizeUidOrder } from "./sort-debug";
import type { SortColumn, SortDirection, TrackMeta } from "./types";

export interface PlaylistTrackItem {
  uri?: string;
  uid?: string;
  addedAt?: string;
}

const ORIGINAL_ORDER_PREFIX = "ptc:original-order:";

type MovePosition = { before?: "start" | { uid: string }; after?: "end" | { uid: string } };

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
  const uids = getUidOrder(items);
  if (!uids.length) return;
  sessionStorage.setItem(key, JSON.stringify(uids));
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

export function uidsMatchOrder(items: PlaylistTrackItem[], targetUids: string[]) {
  const current = getUidOrder(items);
  if (current.length !== targetUids.length) return false;
  return current.every((uid, i) => uid === targetUids[i]);
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

async function movePlaylistItem(playlistUri: string, item: PlaylistTrackItem, position: MovePosition) {
  if (!item.uid || !item.uri) throw new Error("missing uid or uri for move");
  const t0 = Date.now();
  await Spicetify.Platform.PlaylistAPI.move(playlistUri, [{ uri: item.uri, uid: item.uid }], position);
  const durationMs = Date.now() - t0;
  logSortTrace("move.item.ok", { uid: item.uid, durationMs });
  if (durationMs < 5) {
    logSortTrace("move.item.suspicious_fast", { uid: item.uid, durationMs });
  }
}

export async function reorderPlaylistByUids(playlistUri: string, sortedItems: PlaylistTrackItem[]) {
  const movable = sortedItems.filter((i) => i.uid && i.uri);
  if (movable.length < 2) {
    logSortTrace("reorder.skip", { reason: "too_few_tracks", count: movable.length });
    return;
  }

  const targetUids = getUidOrder(movable);
  const current = await fetchPlaylistItems(playlistUri);
  const currentUids = getUidOrder(current);
  logSortTrace("reorder.preflight", {
    playlistUri,
    trackCount: movable.length,
    currentUids: summarizeUidOrder(currentUids),
    targetUids: summarizeUidOrder(targetUids),
    matches: uidsMatchOrder(current, targetUids),
  });

  if (uidsMatchOrder(current, targetUids)) {
    debugLog("reorder skipped: order already matches");
    logSortTrace("reorder.skip", { reason: "already_matches" });
    return;
  }

  logSortTrace("reorder.seq.start", { trackCount: movable.length });
  const moveT0 = Date.now();

  for (let i = movable.length - 1; i >= 0; i--) {
    await movePlaylistItem(playlistUri, movable[i], { before: "start" });
  }

  const moveDurationMs = Date.now() - moveT0;
  const postItems = await fetchPlaylistItems(playlistUri);
  const postUids = getUidOrder(postItems);
  const movedCount = movable.length;
  logSortTrace("reorder.post_move", {
    playlistUri,
    moveDurationMs,
    movedCount,
    ...mismatchInfo(postUids, targetUids),
  });

  debugLog(`reordered ${movedCount}/${movable.length} tracks via sequential insert before:start`);
  logSortTrace("reorder.seq.done", { trackCount: movable.length, movedCount, moveDurationMs });
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

export async function verifyPlaylistOrder(playlistUri: string, targetUids: string[]) {
  const items = await fetchPlaylistItems(playlistUri);
  const currentUids = getUidOrder(items);
  const ok = uidsMatchOrder(items, targetUids);
  if (!ok) {
    logSortTrace("verify.mismatch", {
      playlistUri,
      ...mismatchInfo(currentUids, targetUids),
    });
  }
  return ok;
}

export async function verifyPlaylistOrderWithRetry(
  playlistUri: string,
  targetUids: string[],
  opts?: { attempts?: number; delayMs?: number }
) {
  const attempts = opts?.attempts ?? 3;
  const delayMs = opts?.delayMs ?? 300;

  logSortTrace("verify.start", { playlistUri, attempts, delayMs, targetLen: targetUids.length });

  for (let i = 0; i < attempts; i++) {
    const items = await fetchPlaylistItems(playlistUri);
    const currentUids = getUidOrder(items);
    const ok = uidsMatchOrder(items, targetUids);
    logSortTrace("verify.attempt", {
      attempt: i + 1,
      ok,
      ...mismatchInfo(currentUids, targetUids),
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
