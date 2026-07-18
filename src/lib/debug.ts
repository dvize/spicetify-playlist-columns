export interface DiagnosticSnapshot {
  at: string;
  rows: number;
  urisFound: number;
  sampleUri: string | null;
  dataCells: number;
  protobuf: boolean;
  authToken: boolean;
  metadataClient: boolean;
  graphqlGetTrack: boolean;
  batch?: {
    requested: number;
    popularity: number;
    plays: number;
    genres: number;
  };
  probe?: {
    uri: string;
    popularity: number | null;
    plays: number | null;
    genres: number;
    error?: string;
  };
}

const LOG_KEY = "ptc:debug-log";
const MAX_LOG = 200;

export function debugLog(message: string) {
  const line = `${new Date().toISOString().slice(11, 19)} ${message}`;
  try {
    const prev = JSON.parse(localStorage.getItem(LOG_KEY) || "[]") as string[];
    prev.push(line);
    while (prev.length > MAX_LOG) prev.shift();
    localStorage.setItem(LOG_KEY, JSON.stringify(prev));
  } catch {
    // ignore
  }
  console.log("[Playlist Columns]", message);
}

export function getDebugLog(): string[] {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY) || "[]") as string[];
  } catch {
    return [];
  }
}

export function clearDebugLog() {
  localStorage.removeItem(LOG_KEY);
}

let lastSnapshot: DiagnosticSnapshot | null = null;

export function setDiagnosticSnapshot(snapshot: DiagnosticSnapshot) {
  lastSnapshot = snapshot;
  try {
    localStorage.setItem("ptc:debug-snapshot", JSON.stringify(snapshot));
  } catch {
    // ignore
  }
}

export function getDiagnosticSnapshot(): DiagnosticSnapshot | null {
  if (lastSnapshot) return lastSnapshot;
  try {
    const raw = localStorage.getItem("ptc:debug-snapshot");
    return raw ? (JSON.parse(raw) as DiagnosticSnapshot) : null;
  } catch {
    return null;
  }
}
