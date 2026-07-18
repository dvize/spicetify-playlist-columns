import { debugLog, getDiagnosticSnapshot, setDiagnosticSnapshot, type DiagnosticSnapshot } from "./debug";
import { ensureTrackMetadata, getTrackMeta } from "./metadata";
import { getTrackUriFromRow } from "./tracklist";

function hasProtobuf() {
  return !!(globalThis as { protobuf?: { Root?: unknown } }).protobuf?.Root;
}

function hasAuthToken() {
  try {
    return !!Spicetify.Platform.AuthorizationAPI?.getState?.()?.token?.accessToken;
  } catch {
    return false;
  }
}

function hasMetadataClient() {
  try {
    const chunk = (window as unknown as { webpackChunkclient_web: unknown[] }).webpackChunkclient_web;
    if (!chunk) return false;
    const req = chunk.push([[Symbol()], {}, (r: unknown) => r]) as { m: Record<string, unknown> };
    return Object.values(req.m).some((m) => {
      try {
        const key = Object.keys(req.m).find((k) => req.m[k] === m);
        if (!key) return false;
        const mod = (req as unknown as (k: string) => Record<string, unknown>)(key);
        return Object.values(mod).some((c) => (c as { SERVICE_ID?: string })?.SERVICE_ID === "spotify.mdata_esperanto.proto.MetadataService");
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

export async function collectDiagnostics(tracklist?: Element | null): Promise<DiagnosticSnapshot> {
  const root = tracklist || document.querySelector(".main-trackList-indexable");
  const rows = root ? root.querySelectorAll(".main-trackList-trackListRow") : [];
  const uris: string[] = [];
  rows.forEach((row) => {
    const uri = getTrackUriFromRow(row);
    if (uri) uris.push(uri);
  });

  const snapshot: DiagnosticSnapshot = {
    at: new Date().toLocaleString(),
    rows: rows.length,
    urisFound: uris.length,
    sampleUri: uris[0] || null,
    dataCells: root ? root.querySelectorAll(".ptc-data-cell").length : 0,
    protobuf: hasProtobuf(),
    authToken: hasAuthToken(),
    metadataClient: hasMetadataClient(),
    graphqlGetTrack: !!Spicetify.GraphQL?.Definitions?.getTrack,
  };

  debugLog(`diag rows=${snapshot.rows} uris=${snapshot.urisFound} cells=${snapshot.dataCells}`);

  if (uris[0]) {
    try {
      await ensureTrackMetadata([uris[0]]);
      const meta = getTrackMeta(uris[0]);
      snapshot.probe = {
        uri: uris[0],
        popularity: meta?.popularity ?? null,
        plays: meta?.plays ?? null,
        genres: meta?.genres?.length ?? 0,
      };
      debugLog(
        `probe ${uris[0]} pop=${snapshot.probe.popularity} plays=${snapshot.probe.plays} genres=${snapshot.probe.genres}`
      );
    } catch (e) {
      snapshot.probe = {
        uri: uris[0],
        popularity: null,
        plays: null,
        genres: 0,
        error: String(e),
      };
      debugLog(`probe failed: ${e}`);
    }
  }

  setDiagnosticSnapshot(snapshot);
  return snapshot;
}

export function summarizeBatch(
  requested: number,
  counts: { popularity: number; plays: number; genres: number }
) {
  const snap = getDiagnosticSnapshot();
  const next: DiagnosticSnapshot = {
    ...(snap || {
      at: new Date().toLocaleString(),
      rows: 0,
      urisFound: 0,
      sampleUri: null,
      dataCells: 0,
      protobuf: hasProtobuf(),
      authToken: hasAuthToken(),
      metadataClient: hasMetadataClient(),
      graphqlGetTrack: !!Spicetify.GraphQL?.Definitions?.getTrack,
    }),
    batch: { requested, ...counts },
  };
  setDiagnosticSnapshot(next);
  debugLog(`batch ${counts.popularity}/${requested} pop, ${counts.plays}/${requested} plays, ${counts.genres}/${requested} genres`);
}
