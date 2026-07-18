/** Grid templates adapted from spicetify-dj-info (per-row layout). */

const TEMPLATES: Record<number, string> = {
  4: "[index] 16px [first] 4fr [var1] 2fr [last] minmax(120px,1fr)",
  5: "[index] 16px [first] 6fr [var1] 4fr [var2] 3fr [last] minmax(120px,1fr)",
  6: "[index] 16px [first] 6fr [var1] 4fr [var2] 2.5fr [var3] 3fr [last] minmax(120px,1fr)",
  7: "[index] 16px [first] 6fr [var1] 3fr [var2] 2fr [var3] 2.5fr [var4] 3fr [last] minmax(120px,1fr)",
  8: "[index] 16px [first] 6fr [var1] 1.2fr [var2] 1fr [var3] 2fr [var4] 2.5fr [var5] 3fr [last] minmax(120px,1fr)",
  9: "[index] 16px [first] 6fr [var1] 1.2fr [var2] 1fr [var3] 2fr [var4] 2fr [var5] 2fr [var6] 3fr [last] minmax(120px,1fr)",
  10: "[index] 16px [first] 6fr [var1] 1.2fr [var2] 1fr [var3] 1.5fr [var4] 1.5fr [var5] 2fr [var6] 2fr [var7] 3fr [last] minmax(120px,1fr)",
  11: "[index] 16px [first] 6fr [var1] 1fr [var2] 1fr [var3] 1.5fr [var4] 1.5fr [var5] 1.5fr [var6] 2fr [var7] 2fr [var8] 3fr [last] minmax(120px,1fr)",
  12: "[index] 16px [first] 5fr [var1] 1fr [var2] 1fr [var3] 1.2fr [var4] 1.2fr [var5] 1.5fr [var6] 1.5fr [var7] 2fr [var8] 2fr [var9] 3fr [last] minmax(120px,1fr)",
};

export function getGridTemplateForSlots(slots: number) {
  if (TEMPLATES[slots]) return TEMPLATES[slots];
  if (slots < 4) return TEMPLATES[4];
  let template = "[index] 16px [first] 5fr ";
  for (let i = 1; i < slots - 2; i++) {
    template += `[var${i}] 2fr `;
  }
  template += "[last] minmax(120px,1fr)";
  return template;
}

function isPtcOrExternalDj(el: Element) {
  return (
    el.classList.contains("ptc-header-cell") ||
    el.classList.contains("ptc-data-cell") ||
    el.classList.contains("ptc-skeleton-cell") ||
    el.classList.contains("djInfoList") ||
    el.classList.contains("djinfoheader") ||
    !!el.querySelector(".djinfoheader")
  );
}

function isNativeSection(el: Element) {
  return (
    el.classList.contains("main-trackList-rowSectionVariable") ||
    el.classList.contains("main-trackList-rowSectionEnd") ||
    el.classList.contains("main-trackList-rowSectionStart") ||
    el.classList.contains("main-trackList-rowSectionIndex")
  );
}

export function getNativeVisibleColumnCount(row: Element) {
  let count = 0;
  for (const child of Array.from(row.children)) {
    if (isPtcOrExternalDj(child)) continue;
    if (!isNativeSection(child)) continue;
    if (child.classList.contains("ptc-native-hidden")) continue;
    if (window.getComputedStyle(child).display === "none") continue;
    count++;
  }
  return count;
}

/** Custom cells always sit immediately before rowSectionEnd. */
export function getInsertionAnchor(row: Element) {
  return row.querySelector(":scope > .main-trackList-rowSectionEnd");
}

export function applyRowGrid(row: Element, customColumnCount: number, fixedSlots?: number) {
  if (customColumnCount <= 0 && !fixedSlots) {
    row.style.removeProperty("grid-template-columns");
    return;
  }
  const slots = fixedSlots ?? getNativeVisibleColumnCount(row) + customColumnCount;
  const template = getGridTemplateForSlots(slots);
  row.style.setProperty("grid-template-columns", template);
}

export function getTracklistGridSlots(root: Element, customColumnCount: number) {
  const header = root.querySelector(".main-trackList-trackListHeaderRow");
  if (!header) return customColumnCount + 4;
  return getNativeVisibleColumnCount(header) + customColumnCount;
}

export function cellsImmediatelyBeforeAnchor(row: Element, anchor: Element | null) {
  if (!anchor) return [];
  const out: string[] = [];
  let prev = anchor.previousElementSibling;
  while (prev?.classList.contains("ptc-data-cell")) {
    out.unshift((prev as HTMLElement).dataset.ptcColumn || "?");
    prev = prev.previousElementSibling;
  }
  return out;
}

export function rowCellsAligned(row: Element, visibleIds: string[]) {
  const anchor = getInsertionAnchor(row);
  if (!anchor) return { broken: true, reason: "no anchor" };

  const cells = Array.from(row.querySelectorAll(":scope > .ptc-data-cell")) as HTMLElement[];
  if (cells.length !== visibleIds.length) {
    return { broken: true, reason: `ptc count ${cells.length} != ${visibleIds.length}` };
  }

  const before = cellsImmediatelyBeforeAnchor(row, anchor);
  if (before.join(",") !== visibleIds.join(",")) {
    return { broken: true, reason: `order [${before}] != [${visibleIds}]` };
  }

  return { broken: false };
}
