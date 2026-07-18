import { getGridTemplateForSlots, getInsertionAnchor, getNativeVisibleColumnCount, cellsImmediatelyBeforeAnchor, rowCellsAligned } from "./grid";
import { getDebugLog, debugLog } from "./debug";
import { getVisibleCustomColumns, getTrackUriFromRow } from "./tracklist";
import type { ColumnId } from "./types";

export interface RowLayoutSample {
  index: number;
  uri: string | null;
  childCount: number;
  nativeCount: number;
  ptcCells: string[];
  childSummary: string[];
  gridTemplate: string;
  anchorTag: string | null;
  cellsBeforeAnchor: string[];
  broken: boolean;
  brokenReason?: string;
}

export interface LayoutDebugReport {
  at: string;
  trigger: string;
  playlistUri: string | null;
  visibleColumns: ColumnId[];
  headerNativeCount: number;
  headerSlots: number;
  headerGrid: string;
  rowCount: number;
  brokenRows: number;
  samples: RowLayoutSample[];
  log: string[];
  sortActive: string | null;
}

const EVENTS_KEY = "ptc:debug-events";
const EXPORT_KEY = "ptc:debug-export";
const MAX_EVENTS = 40;

function childSummary(row: Element) {
  return Array.from(row.children).map((c) => {
    const el = c as HTMLElement;
    const parts = [
      el.tagName.toLowerCase(),
      [...el.classList].filter((x) => x.startsWith("main-trackList") || x.startsWith("ptc-")).join("."),
      el.dataset.ptcColumn || "",
    ].filter(Boolean);
    return parts.join("|");
  });
}

export function rowLayoutBroken(row: Element, visibleIds: ColumnId[]) {
  return rowCellsAligned(row, visibleIds);
}

export function captureLayoutReport(tracklist: Element, trigger: string, sortActive: string | null = null): LayoutDebugReport {
  const root = tracklist.classList.contains("main-trackList-trackList")
    ? tracklist
    : tracklist.querySelector(".main-trackList-trackList") || tracklist;
  const visible = getVisibleCustomColumns();
  const visibleIds = visible.map((c) => c.id);
  const header = root.querySelector(".main-trackList-trackListHeaderRow");
  const headerNative = header ? getNativeVisibleColumnCount(header) : 0;
  const slots = headerNative + visible.length;
  const rows = Array.from(root.querySelectorAll(".main-trackList-trackListRow"));

  const samples: RowLayoutSample[] = [];
  let brokenRows = 0;

  rows.forEach((row, index) => {
    const anchor = getInsertionAnchor(row);
    const check = rowLayoutBroken(row, visibleIds);
    if (check.broken) brokenRows++;

  if (index < 5 || index >= rows.length - 3 || check.broken || index % 8 === 0) {
      samples.push({
        index,
        uri: getTrackUriFromRow(row),
        childCount: row.children.length,
        nativeCount: getNativeVisibleColumnCount(row),
        ptcCells: Array.from(row.querySelectorAll(".ptc-data-cell")).map(
          (c) => (c as HTMLElement).dataset.ptcColumn || "?"
        ),
        childSummary: childSummary(row),
        gridTemplate: (row as HTMLElement).style.gridTemplateColumns || "",
        anchorTag: anchor
          ? [...anchor.classList].find((c) => c.startsWith("main-trackList")) || anchor.tagName
          : null,
        cellsBeforeAnchor: cellsImmediatelyBeforeAnchor(row, anchor),
        broken: check.broken,
        brokenReason: check.reason,
      });
    }
  });

  const report: LayoutDebugReport = {
    at: new Date().toISOString(),
    trigger,
    playlistUri: Spicetify.Platform.History?.location?.pathname || null,
    visibleColumns: visibleIds,
    headerNativeCount: headerNative,
    headerSlots: slots,
    headerGrid: header ? getGridTemplateForSlots(slots) : "",
    rowCount: rows.length,
    brokenRows,
    samples,
    log: getDebugLog().slice(-30),
    sortActive,
  };

  return report;
}

export function saveLayoutEvent(report: LayoutDebugReport) {
  debugLog(`layout ${report.trigger}: ${report.brokenRows}/${report.rowCount} broken`);
  try {
    const prev = JSON.parse(localStorage.getItem(EVENTS_KEY) || "[]") as LayoutDebugReport[];
    prev.push(report);
    while (prev.length > MAX_EVENTS) prev.shift();
    localStorage.setItem(EVENTS_KEY, JSON.stringify(prev));
    localStorage.setItem(EXPORT_KEY, JSON.stringify(report, null, 2));
  } catch {
    // ignore
  }
}

export function getLayoutEvents(): LayoutDebugReport[] {
  try {
    return JSON.parse(localStorage.getItem(EVENTS_KEY) || "[]") as LayoutDebugReport[];
  } catch {
    return [];
  }
}

export function getLatestExport(): string | null {
  return localStorage.getItem(EXPORT_KEY);
}

export function downloadDebugFile(report: LayoutDebugReport) {
  const json = JSON.stringify(report, null, 2);
  localStorage.setItem(EXPORT_KEY, json);
  try {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ptc-debug-${Date.now()}.json`;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    Spicetify.showNotification("Debug file downloaded (ptc-debug-*.json)", false, 4000);
  } catch (e) {
    debugLog(`download failed: ${e}`);
  }
}

export function auditTracklist(tracklist: Element, trigger: string, sortActive: string | null = null) {
  const report = captureLayoutReport(tracklist, trigger, sortActive);
  saveLayoutEvent(report);
  if (report.brokenRows > 0) {
    downloadDebugFile(report);
  }
  return report;
}
