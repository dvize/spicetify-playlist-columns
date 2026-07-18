import React from "react";
import ReactDOM from "react-dom";
import { DiagnosticsModal } from "../components/DiagnosticsModal";
import { SettingsModal } from "../components/SettingsModal";
import { loadSortForUri, saveSortForUri, SORT_LABELS } from "./constants";
import { collectDiagnostics } from "./diagnostics";
import { auditTracklist, captureLayoutReport, downloadDebugFile } from "./layout-debug";
import { debugLog } from "./debug";
import { exportSortTrace, logSortTrace, summarizeUidOrder } from "./sort-debug";
import { applyPlaylistContext, ensureTrackMetadata, getTrackCache } from "./metadata";
import {
  canReorderPlaylist,
  clearOriginalOrder,
  getUriOrder,
  isReorderablePlaylist,
  loadOriginalOrder,
  orderItemsByUris,
  reorderPlaylistByUids,
  settleAfterMove,
  snapshotOriginalOrder,
  sortPlaylistItems,
  type CanReorderResult,
  type PlaylistTrackItem,
  urisMatchOrder,
  verifyPlaylistOrderWithRetry,
} from "./playlist-sort";
import { getSettings, saveSettings } from "./settings";
import type { ColumnId, SortColumn, SortDirection, SortState, TrackMeta } from "./types";
import {
  applyNativeColumnVisibility,
  createHeaderButton,
  customColumnsMatch,
  ensureCustomDataCells,
  fillRowData,
  fillSingleRow,
  getCurrentUri,
  getTrackUriFromRow,
  getVisibleCustomColumns,
  isPlaylistPage,
  loadPlaylistTracks,
  processSingleRow,
  shouldProcessPlaylistView,
  updateGridStyle,
  wireNativeHeaderSorting,
} from "./tracklist";
import { getInsertionAnchor } from "./grid";

export class PlaylistColumnsExtension {
  private currentSort: SortState | null = null;
  private currentPlaylistUri: string | null = null;
  private playlistTracks = new Map<string, PlaylistTrackItem[]>();
  private sortInFlight = false;
  private processScheduled = new WeakMap<Element, number>();
  private isUpdating = false;
  private globalObserver: MutationObserver | null = null;
  private rowObserver: IntersectionObserver | null = null;
  private scrollAuditTimer: number | null = null;
  private lastGridKey = "";

  async start() {
    this.watchNavigation();
    this.observeTracklists();
    this.injectToolbar();
    await this.onPlaylistChange();
    console.log("[Playlist Columns] Extension loaded");
  }

  private getSortValue(meta: TrackMeta | undefined, column: SortColumn, item?: PlaylistTrackItem, row?: Element) {
    switch (column) {
      case "genre":
        return (meta?.genres || []).join(", ").toLowerCase() || "";
      case "dj":
        return meta?.djBpm ?? -1;
      case "popularity":
        return meta?.popularity ?? -1;
      case "plays":
        return meta?.plays ?? -1;
      case "title":
        return (
          meta?.title?.toLowerCase() ||
          row?.querySelector('[data-testid="internal-track-link"]')?.textContent?.toLowerCase() ||
          ""
        );
      case "artist":
        return meta?.artist?.toLowerCase() || "";
      case "album":
        return meta?.album?.toLowerCase() || "";
      case "dateAdded":
        return meta?.dateAddedMs ?? (item?.addedAt ? new Date(item.addedAt).getTime() : 0);
      case "duration":
        return meta?.durationMs ?? 0;
      default:
        return null;
    }
  }

  private blockSortIfNotEditable(uri: string, check: CanReorderResult, needsMove: boolean) {
    if (check.allowed || !needsMove) return false;

    logSortTrace("applySort.blocked", {
      uri,
      reason: check.reason,
      editorial: check.editorial,
      canEditItems: check.canEditItems,
      isOwner: check.isOwner,
    });
    exportSortTrace({ auto: true, reason: `blocked_${check.reason}` });

    const message =
      check.reason === "editorial"
        ? "This playlist can’t be reordered (Spotify editorial playlist). Use a playlist you own."
        : "This playlist can’t be reordered (no edit permission). Use a playlist you own.";

    Spicetify.showNotification(`Playlist Columns: ${message}`, false, 6000);
    return true;
  }

  private async finishReorder(uri: string, targetUris: string[]) {
    logSortTrace("finish.start", { uri, targetLen: targetUris.length });
    await settleAfterMove();
    const verified = await verifyPlaylistOrderWithRetry(uri, targetUris, { attempts: 3, delayMs: 300 });
    if (!verified) {
      logSortTrace("finish.failed", { uri, targetUris: summarizeUidOrder(targetUris) });
      exportSortTrace({ auto: true, reason: "verify_failed" });
      Spicetify.showNotification(
        "Playlist Columns: sort did not stick — trace saved (see sort-debug.trace.jsonl)",
        true,
        6000
      );
      debugLog("verify failed: URI order mismatch after replace");
      return false;
    }

    logSortTrace("finish.ok", { uri });
    this.playlistTracks.delete(uri);
    this.lastGridKey = "";
    this.updateSortPill();
    this.updateHeaderSortIndicatorsOnAll();
    await this.refreshAllTracklists("sort-apply");
    return true;
  }

  private cycleSort = (columnId: SortColumn) => {
    if (!this.currentSort || this.currentSort.column !== columnId) {
      void this.applySort(columnId, "desc");
      return;
    }
    if (this.currentSort.direction === "desc") {
      void this.applySort(columnId, "asc");
      return;
    }
    void this.applySort(null);
  };

  private async applySort(
    column: SortColumn | null,
    direction?: SortDirection,
    opts?: { syncOnly?: boolean }
  ) {
    const uri = this.currentPlaylistUri || getCurrentUri();
    if (!uri) {
      Spicetify.showNotification(
        "Playlist Columns: could not identify playlist for sorting",
        false,
        4000
      );
      return;
    }
    this.currentPlaylistUri = uri;

    if (!isReorderablePlaylist(uri)) {
      if (column) {
        Spicetify.showNotification(
          "Playlist Columns: sorting only works on playlists you can reorder",
          false,
          5000
        );
      }
      return;
    }

    if (this.sortInFlight) return;
    this.sortInFlight = true;

    try {
      logSortTrace("applySort.start", {
        uri,
        column,
        direction,
        syncOnly: Boolean(opts?.syncOnly),
      });

      const reorderCheck = await canReorderPlaylist(uri);

      if (!column) {
        const items = await this.getFreshPlaylistTracks(uri);
        const originalUris = loadOriginalOrder(uri);
        if (originalUris?.length) {
          const restored = orderItemsByUris(items, originalUris);
          if (!urisMatchOrder(items, originalUris)) {
            if (this.blockSortIfNotEditable(uri, reorderCheck, true)) return;
            Spicetify.showNotification("Restoring playlist order…", false, 3000);
            await reorderPlaylistByUids(uri, restored);
            saveSortForUri(uri, null);
            clearOriginalOrder(uri);
            this.currentSort = null;
            await this.finishReorder(uri, originalUris);
            return;
          }
        }
        this.currentSort = null;
        saveSortForUri(uri, null);
        clearOriginalOrder(uri);
        this.updateSortPill();
        this.updateHeaderSortIndicatorsOnAll();
        return;
      }

      if (this.blockSortIfNotEditable(uri, reorderCheck, true)) return;

      const dir = direction || "desc";
      this.currentSort = { column, direction: dir };
      saveSortForUri(uri, this.currentSort);
      debugLog(`sort ${column} ${dir}`);

      const items = await this.getFreshPlaylistTracks(uri);
      const trackUris = items.map((t) => t.uri).filter((u): u is string => Boolean(u));
      await ensureTrackMetadata(trackUris);

      snapshotOriginalOrder(uri, items);

      const cache = getTrackCache();
      const sorted = sortPlaylistItems(items, column, dir, (meta, col, item) => this.getSortValue(meta, col, item), cache);
      const sortedUris = getUriOrder(sorted);

      logSortTrace("applySort.sorted", {
        uri,
        column,
        direction: dir,
        itemCount: items.length,
        beforeUris: summarizeUidOrder(getUriOrder(items)),
        targetUris: summarizeUidOrder(sortedUris),
      });

      if (urisMatchOrder(items, sortedUris)) {
        debugLog(`sort ${column} ${dir}: order already matches`);
        this.updateSortPill();
        this.updateHeaderSortIndicatorsOnAll();
        return;
      }

      Spicetify.showNotification(opts?.syncOnly ? "Applying saved sort…" : "Sorting playlist…", false, 3000);
      await reorderPlaylistByUids(uri, sorted);
      await this.finishReorder(uri, sortedUris);
    } catch (e) {
      logSortTrace("applySort.error", { error: String(e) });
      exportSortTrace({ auto: true, reason: "exception" });
      console.warn("[Playlist Columns] Sort failed", e);
      Spicetify.showNotification("Playlist Columns: sort failed", true, 5000);
      debugLog(`sort failed: ${e}`);
    } finally {
      this.sortInFlight = false;
    }
  }

  private updateHeaderSortIndicatorsOnAll() {
    document.querySelectorAll(".main-trackList-indexable").forEach((tl) => this.updateHeaderSortIndicators(tl));
  }

  private updateHeaderSortIndicators(tracklist: Element) {
    tracklist.querySelectorAll(".ptc-col-header").forEach((btn) => {
      const col = (btn as HTMLElement).dataset.ptcColumn;
      const indicator = btn.querySelector(".ptc-sort-indicator");
      btn.classList.toggle("ptc-sorted", this.currentSort?.column === col);
      if (indicator) {
        indicator.textContent =
          this.currentSort?.column === col ? (this.currentSort.direction === "asc" ? "▲" : "▼") : "";
      }
    });
  }

  private getStructureKey(tracklist: Element) {
    const visible = getVisibleCustomColumns();
    const settings = getSettings();
    return `${visible.map((c) => c.id).join(",")}|${JSON.stringify(settings.native)}`;
  }

  private ensureCustomColumns(tracklist: Element) {
    const headerRow = tracklist.querySelector(".main-trackList-trackListHeaderRow");
    if (!headerRow) return;

    const visible = getVisibleCustomColumns();
    const visibleIds = new Set(visible.map((c) => c.id));
    const insertAnchor = getInsertionAnchor(headerRow);
    const structureKey = this.getStructureKey(tracklist);

    const headerCells = Array.from(headerRow.querySelectorAll(".ptc-header-cell"));
    headerCells.forEach((el) => {
      const colId = el.querySelector(".ptc-col-header")?.getAttribute("data-ptc-column");
      if (colId && !visibleIds.has(colId as typeof visible[number]["id"])) el.remove();
    });

    tracklist.querySelectorAll(".ptc-data-cell").forEach((el) => {
      const colId = (el as HTMLElement).dataset.ptcColumn;
      if (colId && !visibleIds.has(colId as typeof visible[number]["id"])) el.remove();
    });
    tracklist.querySelectorAll(".ptc-skeleton-cell").forEach((el) => {
      const colId = (el as HTMLElement).dataset.ptcColumn;
      if (colId && !visibleIds.has(colId as typeof visible[number]["id"])) el.remove();
    });

    const currentHeaders = Array.from(headerRow.querySelectorAll(".ptc-header-cell"));
    const needsHeaderRebuild =
      structureKey !== this.lastGridKey || !customColumnsMatch(visible, currentHeaders);

    if (needsHeaderRebuild) {
      currentHeaders.forEach((el) => el.remove());
      let insertBefore: ChildNode | null = insertAnchor;
      for (let i = visible.length - 1; i >= 0; i--) {
        const col = visible[i];
        const headerCell = document.createElement("div");
        headerCell.className = "main-trackList-rowSectionVariable ptc-header-cell";
        headerCell.setAttribute("role", "columnheader");
        headerCell.appendChild(createHeaderButton(col.label, col.id, this.cycleSort));
        if (insertBefore) headerRow.insertBefore(headerCell, insertBefore);
        else headerRow.appendChild(headerCell);
        insertBefore = headerCell;
      }
      this.lastGridKey = structureKey;
    }

    tracklist.querySelectorAll(".main-trackList-trackListRow").forEach((row) => {
      const existing = Array.from(row.querySelectorAll(".ptc-data-cell"));
      if (!customColumnsMatch(visible, existing)) {
        (row as HTMLElement).dataset.ptcFilled = "";
      }
    });

    const needsNativeWire = Array.from(
      headerRow.querySelectorAll('[role="columnheader"]:not(.ptc-header-cell):not(.ptc-native-hidden)')
    ).some((el) => !(el as HTMLElement).dataset.ptcWired);

    if (needsHeaderRebuild || needsNativeWire) {
      wireNativeHeaderSorting(tracklist, this.cycleSort);
    }

    applyNativeColumnVisibility(tracklist);
    ensureCustomDataCells(tracklist);
    updateGridStyle(tracklist);
    this.updateHeaderSortIndicators(tracklist);
  }

  private scheduleProcessTracklist(tracklist: Element) {
    if (this.processScheduled.has(tracklist)) return;
    const id = requestAnimationFrame(() => {
      this.processScheduled.delete(tracklist);
      if (this.isUpdating) return;
      void this.processTracklist(tracklist);
    });
    this.processScheduled.set(tracklist, id);
  }

  private metadataRetryTimer: number | null = null;

  private async processTracklist(tracklist: Element) {
    if (!shouldProcessPlaylistView()) return;

    this.isUpdating = true;
    try {
      this.ensureCustomColumns(tracklist);
    } finally {
      this.isUpdating = false;
    }

    await fillRowData(tracklist);
    this.scheduleMetadataRetry(tracklist);
  }

  private scheduleMetadataRetry(tracklist: Element) {
    const needsRetry = Array.from(tracklist.querySelectorAll(".main-trackList-trackListRow")).some((row) => {
      const uri = getTrackUriFromRow(row);
      if (!uri) return false;
      const meta = getTrackCache().get(uri);
      return !meta?.complete;
    });
    if (!needsRetry) return;
    if (this.metadataRetryTimer != null) return;
    this.metadataRetryTimer = window.setTimeout(() => {
      this.metadataRetryTimer = null;
      tracklist.querySelectorAll(".main-trackList-trackListRow").forEach((row) => {
        delete (row as HTMLElement).dataset.ptcFilled;
      });
      void fillRowData(tracklist);
    }, 2500);
  }

  private async refreshAllTracklists(auditTrigger?: string) {
    this.lastGridKey = "";
    const tracklists = Array.from(document.querySelectorAll(".main-trackList-indexable"));
    for (const tl of tracklists) {
      tl.querySelectorAll(".main-trackList-trackListRow").forEach((row) => {
        (row as HTMLElement).dataset.ptcFilled = "";
      });
      await this.processTracklist(tl);
    }
    this.updateSortPill();
    if (auditTrigger) {
      tracklists.forEach((tl) => auditTracklist(tl, auditTrigger, this.currentSort?.column || null));
    }
  }

  private getScrollRoot(tracklist: Element) {
    return tracklist.closest(".os-viewport") || tracklist.parentElement || tracklist;
  }

  private setupRowObserver(tracklist: Element) {
    if (this.rowObserver) return;
    const root = this.getScrollRoot(tracklist);
    this.rowObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const row = entry.target;
          const tl = row.closest(".main-trackList-indexable");
          if (!tl || this.isUpdating) continue;
          requestAnimationFrame(() => {
            processSingleRow(row, tl);
            void fillSingleRow(row);
          });
        }
      },
      { root: root instanceof Element ? root : null, threshold: 0.05 }
    );
  }

  private observeRow(row: Element, tracklist: Element) {
    if ((row as HTMLElement).dataset.ptcRowObs) return;
    (row as HTMLElement).dataset.ptcRowObs = "1";
    this.setupRowObserver(tracklist);
    this.rowObserver?.observe(row);
  }

  private attachScrollAudit(tracklist: Element) {
    const scrollRoot = this.getScrollRoot(tracklist);
    if (!(scrollRoot instanceof Element) || (scrollRoot as HTMLElement).dataset.ptcScrollAudit) return;
    (scrollRoot as HTMLElement).dataset.ptcScrollAudit = "1";
    scrollRoot.addEventListener(
      "scroll",
      () => {
        if (this.scrollAuditTimer != null) window.clearTimeout(this.scrollAuditTimer);
        this.scrollAuditTimer = window.setTimeout(() => {
          this.scrollAuditTimer = null;
          if (this.isUpdating) return;
          void this.processTracklist(tracklist).then(() => {
            auditTracklist(tracklist, "scroll", this.currentSort?.column || null);
          });
        }, 500);
      },
      { passive: true }
    );
  }

  private observeRowsInTracklist(tracklist: Element) {
    tracklist.querySelectorAll(".main-trackList-trackListRow").forEach((row) => this.observeRow(row, tracklist));
  }

  private mutationHasNewRows(mutations: MutationRecord[]) {
    for (const m of mutations) {
      for (const node of Array.from(m.addedNodes)) {
        if (!(node instanceof Element)) continue;
        if (node.classList.contains("main-trackList-trackListRow")) return true;
        if (node.querySelector?.(".main-trackList-trackListRow")) return true;
      }
    }
    return false;
  }

  private observeTracklists() {
    const attach = (tracklist: Element) => {
      if ((tracklist as HTMLElement).dataset.ptcObserved) return;
      (tracklist as HTMLElement).dataset.ptcObserved = "1";

      const observer = new MutationObserver((mutations) => {
        if (this.isUpdating) return;
        if (this.mutationHasNewRows(mutations)) {
          this.observeRowsInTracklist(tracklist);
          this.scheduleProcessTracklist(tracklist);
        }
      });
      observer.observe(tracklist, { childList: true, subtree: true });
      this.attachScrollAudit(tracklist);
      this.observeRowsInTracklist(tracklist);
      void this.processTracklist(tracklist).then(() => {
        auditTracklist(tracklist, "initial-load", this.currentSort?.column || null);
      });
    };

    const scan = () => {
      document.querySelectorAll(".main-trackList-indexable").forEach(attach);
    };

    scan();
    if (!this.globalObserver) {
      this.globalObserver = new MutationObserver(() => scan());
      this.globalObserver.observe(document.body, { childList: true, subtree: false });
    }
  }

  private updateSortPill() {
    const pill = document.getElementById("ptc-sort-pill") as HTMLButtonElement | null;
    if (!pill) return;
    if (!this.currentSort?.column) {
      pill.style.display = "none";
      return;
    }
    const label = SORT_LABELS[this.currentSort.column] || this.currentSort.column;
    const arrow = this.currentSort.direction === "asc" ? "↑" : "↓";
    pill.textContent = `Sorted by ${label} ${arrow} (click to clear)`;
    pill.style.display = "";
  }

  private injectToolbar() {
    const filterRow =
      document.querySelector(".main-actionBar-ActionBar") ||
      document.querySelector('[data-testid="action-bar"]') ||
      document.querySelector(".main-topBar-topbarContent");
    if (!filterRow) return;

    if (!document.getElementById("ptc-toolbar-btn")) {
      const btn = document.createElement("button");
      btn.id = "ptc-toolbar-btn";
      btn.className = "ptc-toolbar-btn";
      btn.type = "button";
      btn.textContent = "Columns";
      btn.title = "Playlist Columns settings";
      btn.addEventListener("click", () => this.openSettingsModal());
      filterRow.appendChild(btn);
    }

    if (!document.getElementById("ptc-debug-btn")) {
      const debugBtn = document.createElement("button");
      debugBtn.id = "ptc-debug-btn";
      debugBtn.className = "ptc-toolbar-btn";
      debugBtn.type = "button";
      debugBtn.textContent = "Export debug";
      debugBtn.title = "Download layout debug JSON (auto-downloads when scroll/sort breaks)";
      debugBtn.addEventListener("click", () => {
        const tracklist = document.querySelector(".main-trackList-indexable");
        const report = captureLayoutReport(tracklist || document.body, "manual-export", this.currentSort?.column || null);
        downloadDebugFile(report);
      });
      filterRow.appendChild(debugBtn);
    }

    if (!document.getElementById("ptc-sort-trace-btn")) {
      const traceBtn = document.createElement("button");
      traceBtn.id = "ptc-sort-trace-btn";
      traceBtn.className = "ptc-toolbar-btn";
      traceBtn.type = "button";
      traceBtn.textContent = "Sort trace";
      traceBtn.title = "Download sort debug trace (run npm run sort-log for live file)";
      traceBtn.addEventListener("click", () => exportSortTrace({ reason: "manual" }));
      filterRow.appendChild(traceBtn);
    }

    if (!document.getElementById("ptc-diag-btn")) {
      const diagBtn = document.createElement("button");
      diagBtn.id = "ptc-diag-btn";
      diagBtn.className = "ptc-toolbar-btn";
      diagBtn.type = "button";
      diagBtn.textContent = "Diagnostics";
      diagBtn.title = "Debug metadata without DevTools";
      diagBtn.addEventListener("click", () => this.openDiagnosticsModal());
      filterRow.appendChild(diagBtn);
    }

    if (!document.getElementById("ptc-sort-pill")) {
      const pill = document.createElement("button");
      pill.id = "ptc-sort-pill";
      pill.className = "ptc-sort-pill";
      pill.type = "button";
      pill.style.display = "none";
      pill.addEventListener("click", () => void this.applySort(null));
      filterRow.appendChild(pill);
    }

    this.updateSortPill();
  }

  private openDiagnosticsModal() {
    let root = document.getElementById("ptc-diagnostics-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "ptc-diagnostics-root";
      document.body.appendChild(root);
    }

    const close = () => ReactDOM.unmountComponentAtNode(root!);

    ReactDOM.render(React.createElement(DiagnosticsModal, { onClose: close }), root);
  }

  private openSettingsModal() {
    let root = document.getElementById("ptc-settings-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "ptc-settings-root";
      document.body.appendChild(root);
    }

    const close = () => ReactDOM.unmountComponentAtNode(root!);

    ReactDOM.render(
      React.createElement(SettingsModal, {
        initial: structuredClone(getSettings()),
        onSave: (next) => {
          saveSettings(next);
          const sortedCol = this.currentSort?.column;
          if (sortedCol && (sortedCol === "genre" || sortedCol === "popularity" || sortedCol === "plays" || sortedCol === "dj")) {
            if (next.columns[sortedCol as ColumnId] === false) void this.applySort(null);
          }
          this.refreshAllTracklists();
        },
        onClose: close,
      }),
      root
    );
  }

  private async getFreshPlaylistTracks(uri: string) {
    this.playlistTracks.delete(uri);
    return this.getPlaylistTracks(uri);
  }

  private async getPlaylistTracks(uri: string) {
    if (this.playlistTracks.has(uri)) return this.playlistTracks.get(uri)!;
    const tracks = await loadPlaylistTracks(uri);
    applyPlaylistContext(tracks);
    this.playlistTracks.set(uri, tracks);
    return tracks;
  }

  private async onPlaylistChange() {
    const uri = getCurrentUri();
    if (!isPlaylistPage(uri)) {
      this.currentPlaylistUri = null;
      this.currentSort = null;
      return;
    }
    if (uri === this.currentPlaylistUri) return;
    this.currentPlaylistUri = uri;
    this.playlistTracks.delete(uri);
    this.lastGridKey = "";
    const settings = getSettings();
    const saved = loadSortForUri(uri);
    if (saved?.column) {
      this.currentSort = saved;
      await this.applySort(saved.column, saved.direction, { syncOnly: true });
    } else if (settings.defaultSort?.column) {
      await this.applySort(settings.defaultSort.column, settings.defaultSort.direction || "desc", {
        syncOnly: true,
      });
    } else {
      this.currentSort = null;
    }
    this.injectToolbar();
    void this.prefetchPlaylistMetadata();
    void this.runAutoDiagnostics();
  }

  private async runAutoDiagnostics() {
    await new Promise((r) => setTimeout(r, 3000));
    const tracklist = document.querySelector(".main-trackList-indexable");
    if (!tracklist) return;
    const snapshot = await collectDiagnostics(tracklist);
    const empty =
      snapshot.urisFound > 0 &&
      (!snapshot.probe ||
        (snapshot.probe.popularity == null && snapshot.probe.plays == null && snapshot.probe.genres === 0));
    if (empty) {
      Spicetify.showNotification(
        "Playlist Columns: metadata empty — click Diagnostics in the toolbar",
        false,
        6000
      );
      debugLog("auto-diag: metadata empty, notification shown");
    }
  }

  private async prefetchPlaylistMetadata() {
    const uri = getCurrentUri();
    if (!isPlaylistPage(uri)) return;
    const tracks = await this.getPlaylistTracks(uri!);
    const uris = tracks.map((t) => t.uri).filter((u): u is string => Boolean(u));
    for (let i = 0; i < uris.length; i += 100) {
      await ensureTrackMetadata(uris.slice(i, i + 100));
      document.querySelectorAll(".main-trackList-indexable").forEach((tl) => void fillRowData(tl));
    }
  }

  private watchNavigation() {
    const check = () => void this.onPlaylistChange();
    Spicetify.Platform.History?.listen?.(check);
    setInterval(check, 1000);
  }
}

