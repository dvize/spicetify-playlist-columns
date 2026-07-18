export interface SortTraceEvent {
  t: number;
  iso: string;
  phase: string;
  data?: Record<string, unknown>;
}

const TRACE_KEY = "ptc:sort-trace";
const MAX_EVENTS = 300;
const LOG_SERVER = "http://127.0.0.1:39281/ptc-sort";

export function summarizeUidOrder(uids: string[], max = 10) {
  if (uids.length <= max) return uids;
  const half = Math.floor(max / 2);
  return [...uids.slice(0, half), `…+${uids.length - max}…`, ...uids.slice(-half)];
}

export function mismatchInfo(current: string[], target: string[]) {
  const len = Math.max(current.length, target.length);
  let first = -1;
  for (let i = 0; i < len; i++) {
    if (current[i] !== target[i]) {
      first = i;
      break;
    }
  }
  return {
    currentLen: current.length,
    targetLen: target.length,
    firstMismatchIndex: first,
    currentAtMismatch:
      first >= 0
        ? { index: first, currentUid: current[first] ?? null, targetUid: target[first] ?? null }
        : null,
    currentSample: summarizeUidOrder(current),
    targetSample: summarizeUidOrder(target),
  };
}

export function logSortTrace(phase: string, data?: Record<string, unknown>) {
  const event: SortTraceEvent = {
    t: Date.now(),
    iso: new Date().toISOString(),
    phase,
    data,
  };
  console.log("[PTC-SORT]", phase, data ?? "");
  try {
    const prev = JSON.parse(localStorage.getItem(TRACE_KEY) || "[]") as SortTraceEvent[];
    prev.push(event);
    while (prev.length > MAX_EVENTS) prev.shift();
    localStorage.setItem(TRACE_KEY, JSON.stringify(prev));
  } catch {
    // ignore storage errors
  }
  void fetch(LOG_SERVER, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  }).catch(() => {});
}

export function getSortTrace(): SortTraceEvent[] {
  try {
    return JSON.parse(localStorage.getItem(TRACE_KEY) || "[]") as SortTraceEvent[];
  } catch {
    return [];
  }
}

export function clearSortTrace() {
  localStorage.removeItem(TRACE_KEY);
}

export function exportSortTrace(opts?: { auto?: boolean; reason?: string }) {
  const payload = {
    exportedAt: new Date().toISOString(),
    reason: opts?.reason ?? "manual",
    events: getSortTrace(),
  };
  const json = JSON.stringify(payload, null, 2);
  try {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ptc-sort-trace-${Date.now()}.json`;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    if (!opts?.auto) {
      Spicetify.showNotification("Sort trace downloaded (ptc-sort-trace-*.json)", false, 4000);
    }
  } catch (e) {
    console.warn("[PTC-SORT] export failed", e);
  }
}
