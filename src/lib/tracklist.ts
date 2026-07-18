import { CUSTOM_COLUMNS, NATIVE_COLUMN_MAP } from "./constants";
import { getGridTemplateForSlots, getInsertionAnchor, getTracklistGridSlots, cellsImmediatelyBeforeAnchor, rowCellsAligned } from "./grid";
import { formatGenre, formatPlays, ensureTrackMetadata, getTrackMeta } from "./metadata";
import { getSettings } from "./settings";
import type { ColumnId, NativeColumnKey, SortColumn, TrackMeta } from "./types";

export function getCurrentUri() {
  const path = Spicetify.Platform.History.location?.pathname;
  if (!path) return null;
  const segments = path.split("/").filter(Boolean);
  const playlistIndex = segments.indexOf("playlist");
  if (playlistIndex > -1 && segments[playlistIndex + 1]) {
    return `spotify:playlist:${segments[playlistIndex + 1]}`;
  }
  if (segments.includes("collection") && segments.includes("tracks")) {
    return "spotify:collection:tracks";
  }
  if (segments.includes("collection") && segments.includes("local-files")) {
    return "spotify:collection:local-files";
  }
  return null;
}

export function isPlaylistPage(uri: string | null) {
  if (!uri) return false;
  return (
    Spicetify.URI.isPlaylistV1OrV2(uri) ||
    uri === "spotify:collection:tracks" ||
    uri === "spotify:collection:local-files"
  );
}

export function hasTracklistView() {
  return !!document.querySelector(".main-trackList-indexable .main-trackList-trackListRow");
}

export function shouldProcessPlaylistView() {
  return isPlaylistPage(getCurrentUri()) || hasTracklistView();
}

export function getTrackUriFromRow(row: Element) {
  const link = row.querySelector('[data-testid="internal-track-link"]') as HTMLAnchorElement | null;
  if (link?.href) {
    const spotifyMatch = link.href.match(/spotify:track:([a-zA-Z0-9]+)/);
    if (spotifyMatch) return `spotify:track:${spotifyMatch[1]}`;
    const pathMatch = link.href.match(/\/track\/([a-zA-Z0-9]+)/);
    if (pathMatch) return `spotify:track:${pathMatch[1]}`;
  }

  const rowObj = row as Record<string, unknown>;
  const fiber = Object.values(rowObj).find(
    (v) =>
      v &&
      typeof v === "object" &&
      ((v as { pendingProps?: unknown }).pendingProps || (v as { memoizedProps?: unknown }).memoizedProps)
  ) as { pendingProps?: PendingProps; memoizedProps?: PendingProps } | undefined;

  const E = fiber?.pendingProps || fiber?.memoizedProps;
  if (E) {
    const t = E.children;
    const direct =
      t?.[0]?.props?.children?.props?.uri ||
      t?.[0]?.props?.children?.children?.props?.uri ||
      t?.[0]?.props?.children?.[0]?.props?.uri ||
      (E as { value?: { item?: { uri?: string } } }).value?.item?.uri ||
      E.children?.props?.value?.item?.uri;
    if (typeof direct === "string" && direct.includes("spotify:track:")) return direct;
  }

  const search = (obj: unknown, depth = 0, visited = new Set<object>()): string | null => {
    if (!obj || typeof obj !== "object" || depth > 15 || visited.has(obj)) return null;
    visited.add(obj);
    const record = obj as Record<string, unknown>;
    if (typeof record.uri === "string" && record.uri.includes("spotify:track:")) return record.uri;
    const item = record.item as { uri?: string } | undefined;
    if (typeof item?.uri === "string" && item.uri.includes("spotify:track:")) return item.uri;

    const children = record.children || (record.props as Record<string, unknown> | undefined)?.children;
    if (children) {
      if (Array.isArray(children)) {
        for (const child of children) {
          const found = search((child as { props?: unknown })?.props || child, depth + 1, visited);
          if (found) return found;
        }
      } else {
        const found = search(children, depth + 1, visited);
        if (found) return found;
      }
    }
    if (record.props && record.props !== obj) {
      const found = search(record.props, depth + 1, visited);
      if (found) return found;
    }
    return null;
  };

  return search(E || rowObj);
}

interface PendingProps {
  children?: {
    props?: {
      value?: { spec?: { _path?: { uri?: string }[] }; item?: { uri?: string } };
      children?: { props?: { uri?: string; children?: { props?: { uri?: string } } } };
    };
    [index: number]: {
      props?: {
        children?: { props?: { uri?: string; children?: { props?: { uri?: string } } } };
        uri?: string;
      };
    };
  };
  value?: { item?: { uri?: string } };
}

export function getVisibleCustomColumns() {
  const settings = getSettings();
  return CUSTOM_COLUMNS.filter((c) => settings.columns[c.id] !== false);
}

export function customColumnsMatch(visible: { id: ColumnId }[], elements: Element[]) {
  if (elements.length !== visible.length) return false;
  return visible.every((col, i) => (elements[i] as HTMLElement).dataset.ptcColumn === col.id);
}

function getTracklistEl(tracklist: Element) {
  return tracklist.classList.contains("main-trackList-trackList")
    ? tracklist
    : tracklist.querySelector(".main-trackList-trackList") || tracklist;
}

function removeExternalDjInfo(root: Element) {
  root.querySelectorAll(".djInfoList").forEach((el) => el.remove());
  root.querySelectorAll(".djinfoheader").forEach((el) => {
    el.closest(".main-trackList-rowSectionVariable")?.remove();
  });
}

function createDataCell(colId: ColumnId) {
  const dataCell = document.createElement("div");
  dataCell.className = "main-trackList-rowSectionVariable ptc-data-cell";
  dataCell.setAttribute("role", "gridcell");
  dataCell.dataset.ptcColumn = colId;
  const span = document.createElement("span");
  span.className = "encore-text-body-small encore-internal-color-text-subdued";
  dataCell.appendChild(span);
  return dataCell;
}

function createSkeletonCell() {
  const ref = document.querySelector(".main-trackList-rowSectionVariable");
  const baseClass = ref
    ? ref.className.split(" ").filter((c) => !c.startsWith("ptc-")).join(" ")
    : "main-trackList-rowSectionVariable";
  const cell = document.createElement("div");
  cell.className = `${baseClass} ptc-skeleton-cell`;
  return cell;
}

function dedupeDataCells(row: Element, visible: { id: ColumnId }[]) {
  for (const col of visible) {
    const cells = row.querySelectorAll(`.ptc-data-cell[data-ptc-column="${col.id}"]`);
    for (let i = 1; i < cells.length; i++) cells[i].remove();
  }
  row.querySelectorAll(".ptc-data-cell").forEach((el) => {
    const colId = (el as HTMLElement).dataset.ptcColumn as ColumnId | undefined;
    if (colId && !visible.some((c) => c.id === colId)) el.remove();
  });
}

function insertCustomCellsBeforeAnchor(row: Element, visible: { id: ColumnId }[]) {
  const anchor = getInsertionAnchor(row);
  if (!anchor) return;

  dedupeDataCells(row, visible);

  const visibleIds = visible.map((c) => c.id);
  const cells: HTMLElement[] = [];
  for (const col of visible) {
    let cell = row.querySelector(`.ptc-data-cell[data-ptc-column="${col.id}"]`) as HTMLElement | null;
    if (!cell) cell = createDataCell(col.id);
    cells.push(cell);
  }

  const before = cellsImmediatelyBeforeAnchor(row, anchor);
  if (before.join(",") === visibleIds.join(",")) return;

  for (const cell of cells) {
    if (cell.parentElement === row) row.removeChild(cell);
  }
  for (const cell of cells) {
    row.insertBefore(cell, anchor);
  }
}

function applyUnifiedGrid(row: Element, slots: number) {
  if (slots <= 0) {
    row.style.removeProperty("grid-template-columns");
    return;
  }
  row.style.setProperty("grid-template-columns", getGridTemplateForSlots(slots));
}

export function ensureCustomDataCells(tracklist: Element) {
  const root = getTracklistEl(tracklist);
  const visible = getVisibleCustomColumns();
  if (!visible.length) return;

  removeExternalDjInfo(root);

  const slots = getTracklistGridSlots(root, visible.length);
  const headerRow = root.querySelector(".main-trackList-trackListHeaderRow");
  if (headerRow) applyUnifiedGrid(headerRow, slots);

  root.querySelectorAll(".main-trackList-trackListRow").forEach((row) => {
    insertCustomCellsBeforeAnchor(row, visible);
    applyUnifiedGrid(row, slots);
  });

  root
    .querySelectorAll(".main-trackList-trackListRowGrid:not(.main-trackList-trackListRow)")
    .forEach((skeleton) => {
      const anchor = getInsertionAnchor(skeleton);
      if (!anchor) return;
      skeleton.querySelectorAll(".ptc-skeleton-cell").forEach((el) => {
        const colId = (el as HTMLElement).dataset.ptcColumn as ColumnId | undefined;
        if (colId && !visible.some((c) => c.id === colId)) el.remove();
      });
      const cells: HTMLElement[] = [];
      for (const col of visible) {
        let cell = skeleton.querySelector(`.ptc-skeleton-cell[data-ptc-column="${col.id}"]`) as HTMLElement | null;
        if (!cell) {
          cell = createSkeletonCell();
          cell.dataset.ptcColumn = col.id;
        }
        if (cell.parentElement) cell.parentElement.removeChild(cell);
        cells.push(cell);
      }
      for (const cell of cells) skeleton.insertBefore(cell, anchor);
      applyUnifiedGrid(skeleton, slots);
    });
}

export function processSingleRow(row: Element, tracklist: Element) {
  const visible = getVisibleCustomColumns();
  if (!visible.length) return false;

  const root = getTracklistEl(tracklist);
  const slots = getTracklistGridSlots(root, visible.length);
  const visibleIds = visible.map((c) => c.id);

  insertCustomCellsBeforeAnchor(row, visible);
  applyUnifiedGrid(row, slots);

  const check = rowCellsAligned(row, visibleIds);
  return !check.broken;
}

export function applyTracklistLayout(tracklist: Element) {
  const root = getTracklistEl(tracklist);
  const visible = getVisibleCustomColumns();
  removeExternalDjInfo(root);

  if (!visible.length) {
    root.removeAttribute("data-ptc-grid");
    root.querySelectorAll(".main-trackList-trackListHeaderRow, .main-trackList-trackListRow").forEach((row) => {
      row.style.removeProperty("grid-template-columns");
    });
    return;
  }

  root.setAttribute("data-ptc-grid", "1");
  ensureCustomDataCells(root);
}

export function headerMatchesNativeType(text: string, type: NativeColumnKey) {
  const lower = (text || "").toLowerCase();
  return NATIVE_COLUMN_MAP[type]?.some((needle) => lower.includes(needle));
}

export function getNativeColumnElements(tracklist: Element, type: NativeColumnKey) {
  const header = tracklist.querySelector(".main-trackList-trackListHeaderRow");
  if (!header) return { headers: [] as Element[], cells: [] as Element[] };
  const headers = Array.from(header.querySelectorAll('[role="columnheader"]')).filter((el) => {
    const text = el.textContent || "";
    return headerMatchesNativeType(text, type) && !el.classList.contains("ptc-header-cell");
  });
  const colIndexes = headers.map((h) => h.getAttribute("aria-colindex")).filter(Boolean);
  const cells: Element[] = [];
  tracklist.querySelectorAll(".main-trackList-trackListRow").forEach((row) => {
    colIndexes.forEach((idx) => {
      const cell = row.querySelector(`[role="gridcell"][aria-colindex="${idx}"]`);
      if (cell) cells.push(cell);
    });
  });
  return { headers, cells };
}

export function applyNativeColumnVisibility(tracklist: Element) {
  const settings = getSettings();
  for (const type of Object.keys(NATIVE_COLUMN_MAP) as NativeColumnKey[]) {
    const visible = settings.native[type];
    const { headers, cells } = getNativeColumnElements(tracklist, type);
    [...headers, ...cells].forEach((el) => {
      el.classList.toggle("ptc-native-hidden", !visible);
    });
  }
}

export function updateGridStyle(tracklist: Element) {
  applyTracklistLayout(tracklist);
}

function renderDjCell(cell: HTMLElement, meta: TrackMeta) {
  const settings = getSettings();
  cell.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "ptc-dj-cell";

  if (meta.djKey) {
    const tag = document.createElement("span");
    tag.className = "ptc-dj-key";
    tag.textContent = meta.djKey;
    if (settings.dj.camelot) {
      const match = meta.djKey.match(/(\d+[AB])/);
      if (match) tag.classList.add(`ptc-camelot-${match[1]}`);
    }
    wrap.appendChild(tag);
  }

  if (settings.dj.showBpm && meta.djBpm != null) {
    const bpm = document.createElement("span");
    bpm.className = "ptc-dj-bpm";
    bpm.textContent = `${Math.round(meta.djBpm)} bpm`;
    wrap.appendChild(bpm);
  }

  if (!wrap.childElementCount) {
    wrap.textContent = "—";
  }

  cell.appendChild(wrap);
}

export function createHeaderButton(label: string, columnId: ColumnId, onSort: (col: SortColumn) => void) {
  const btn = document.createElement("button");
  btn.className = "ptc-col-header";
  btn.type = "button";
  btn.dataset.ptcColumn = columnId;
  const title = document.createElement("span");
  title.className = "TypeElement-mesto-type standalone-ellipsis-one-line";
  title.textContent = label;
  btn.appendChild(title);
  const indicator = document.createElement("span");
  indicator.className = "ptc-sort-indicator";
  btn.appendChild(indicator);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    onSort(columnId);
  });
  return btn;
}

export function wireNativeHeaderSorting(tracklist: Element, onSort: (col: SortColumn) => void) {
  const header = tracklist.querySelector(".main-trackList-trackListHeaderRow");
  if (!header) return;
  header.querySelectorAll('[role="columnheader"]').forEach((el) => {
    if (el.classList.contains("ptc-header-cell") || el.classList.contains("ptc-native-hidden")) return;
    const text = (el.textContent || "").toLowerCase();
    let col: SortColumn | null = null;
    if (text.includes("title") || el.getAttribute("aria-colindex") === "2") col = "title";
    else if (headerMatchesNativeType(text, "artist")) col = "artist";
    else if (headerMatchesNativeType(text, "album")) col = "album";
    else if (headerMatchesNativeType(text, "dateAdded")) col = "dateAdded";
    else if (el.classList.contains("main-trackList-rowSectionEnd") || text.includes(":")) col = "duration";
    if (!col || (el as HTMLElement).dataset.ptcWired) return;
    (el as HTMLElement).dataset.ptcWired = "1";
    (el as HTMLElement).style.cursor = "pointer";
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      onSort(col!);
    });
  });
}

function fillOneRow(row: Element) {
  const uri = getTrackUriFromRow(row);
  if (!uri) return;
  const htmlRow = row as HTMLElement;
  if (htmlRow.dataset.ptcFilled === uri) {
    const cached = getTrackMeta(uri);
    if (cached?.complete) return;
    delete htmlRow.dataset.ptcFilled;
  }
  const meta = getTrackMeta(uri);
  if (!meta) return;
  row.querySelectorAll(".ptc-data-cell").forEach((cell) => {
    const col = (cell as HTMLElement).dataset.ptcColumn;
    const span = cell.querySelector("span");
    if (!span && col !== "dj") return;
    if (col === "dj") {
      renderDjCell(cell as HTMLElement, meta);
    } else if (col === "genre") span!.textContent = formatGenre(meta.genres);
    else if (col === "popularity") span!.textContent = meta.popularity != null ? String(meta.popularity) : "—";
    else if (col === "plays") span!.textContent = formatPlays(meta.plays);
  });
  if (meta.complete) {
    htmlRow.dataset.ptcFilled = uri;
    row.classList.remove("ptc-processing");
  }
}

export async function fillSingleRow(row: Element) {
  const uri = getTrackUriFromRow(row);
  if (!uri) return;
  await ensureTrackMetadata([uri]);
  fillOneRow(row);
}

export async function fillRowData(tracklist: Element) {
  const rows = tracklist.querySelectorAll(".main-trackList-trackListRow");
  const uris: string[] = [];
  const rowUriMap = new Map<Element, string>();

  rows.forEach((row) => {
    const uri = getTrackUriFromRow(row);
    if (!uri) return;
    const htmlRow = row as HTMLElement;
    if (htmlRow.dataset.ptcFilled === uri) {
      const cached = getTrackMeta(uri);
      if (cached?.complete) return;
      delete htmlRow.dataset.ptcFilled;
    }
    rowUriMap.set(row, uri);
    uris.push(uri);
  });

  if (!uris.length) return;
  await ensureTrackMetadata(uris);
  rows.forEach((row) => {
    if (rowUriMap.has(row)) fillOneRow(row);
  });
}


export async function loadPlaylistTracks(uri: string) {
  try {
    let items: { uri?: string; uid?: string; addedAt?: string }[] = [];
    if (uri === "spotify:collection:tracks") {
      const res = await Spicetify.Platform.LibraryAPI.getTracks({ limit: 9999 });
      items = res?.items || [];
    } else if (uri === "spotify:collection:local-files") {
      const res = await Spicetify.Platform.LibraryAPI.getLocalFiles();
      items = res || [];
    } else {
      const res = await Spicetify.Platform.PlaylistAPI.getContents(uri);
      items = res?.items || [];
    }
    return items.filter((i) => i.uri?.startsWith("spotify:track:") || i.uri?.startsWith("spotify:local:"));
  } catch (e) {
    console.warn("[Playlist Columns] Failed to load playlist", e);
    return [];
  }
}

