import React from "react";
import { clearDebugLog, getDebugLog, getDiagnosticSnapshot } from "../lib/debug";
import type { DiagnosticSnapshot } from "../lib/debug";
import { collectDiagnostics } from "../lib/diagnostics";
import { captureLayoutReport, downloadDebugFile, getLayoutEvents } from "../lib/layout-debug";
import type { LayoutDebugReport } from "../lib/layout-debug";

interface Props {
  onClose: () => void;
}

function yesNo(v: boolean) {
  return v ? "yes" : "NO";
}

function LayoutEventsSummary({ events }: { events: LayoutDebugReport[] }) {
  if (!events.length) return <p>No layout events yet — scroll the playlist or sort a column.</p>;
  const latest = events[events.length - 1];
  return (
    <div className="ptc-diag-grid">
      <div>Events</div><div>{events.length}</div>
      <div>Latest trigger</div><div>{latest.trigger}</div>
      <div>Broken rows</div><div>{latest.brokenRows} / {latest.rowCount}</div>
      <div>Header slots</div><div>{latest.headerSlots} (native {latest.headerNativeCount})</div>
    </div>
  );
}

function DiagnosticsBody({ snapshot, log }: { snapshot: DiagnosticSnapshot | null; log: string[] }) {
  return (
    <>
      <p className="ptc-section-hint">No DevTools needed — this runs inside Spotify.</p>
      {!snapshot ? (
        <p>No diagnostic data yet. Click “Run test” below.</p>
      ) : (
        <div className="ptc-diag-grid">
          <div>Time</div><div>{snapshot.at}</div>
          <div>Rows / URIs / Cells</div><div>{snapshot.rows} / {snapshot.urisFound} / {snapshot.dataCells}</div>
          <div>Sample URI</div><div className="ptc-diag-mono">{snapshot.sampleUri || "—"}</div>
          <div>protobuf</div><div>{yesNo(snapshot.protobuf)}</div>
          <div>auth token</div><div>{yesNo(snapshot.authToken)}</div>
          <div>MetadataService</div><div>{yesNo(snapshot.metadataClient)}</div>
          <div>GraphQL getTrack</div><div>{yesNo(snapshot.graphqlGetTrack)}</div>
          {snapshot.batch ? (
            <>
              <div>Last batch</div>
              <div>
                pop {snapshot.batch.popularity}/{snapshot.batch.requested},{" "}
                plays {snapshot.batch.plays}/{snapshot.batch.requested},{" "}
                genres {snapshot.batch.genres}/{snapshot.batch.requested}
              </div>
            </>
          ) : null}
          {snapshot.probe ? (
            <>
              <div>Probe track</div>
              <div className="ptc-diag-mono">{snapshot.probe.uri}</div>
              <div>Probe result</div>
              <div>
                pop={snapshot.probe.popularity ?? "—"} plays={snapshot.probe.plays ?? "—"} genres={snapshot.probe.genres}
                {snapshot.probe.error ? ` err: ${snapshot.probe.error}` : ""}
              </div>
            </>
          ) : null}
        </div>
      )}
      <h3>Log</h3>
      <pre className="ptc-diag-log">{log.length ? log.join("\n") : "(empty)"}</pre>
      <h3>Layout debug</h3>
      <p className="ptc-section-hint">
        Scroll/sort issues auto-download <code>ptc-debug-*.json</code> when broken rows are detected.
        Use Export layout below to capture manually.
      </p>
      <LayoutEventsSummary events={getLayoutEvents()} />
    </>
  );
}

export function DiagnosticsModal({ onClose }: Props) {
  const [snapshot, setSnapshot] = React.useState<DiagnosticSnapshot | null>(getDiagnosticSnapshot());
  const [log, setLog] = React.useState(getDebugLog());
  const [running, setRunning] = React.useState(false);

  const run = async () => {
    setRunning(true);
    try {
      const s = await collectDiagnostics();
      setSnapshot(s);
      setLog(getDebugLog());
      const ok = s.probe && (s.probe.popularity != null || s.probe.plays != null || s.probe.genres > 0);
      Spicetify.showNotification(
        ok ? "Diagnostics: metadata OK for probe track" : "Diagnostics: metadata still empty — see panel",
        false,
        4000
      );
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="ptc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ptc-modal ptc-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h2>Playlist Columns — Diagnostics</h2>
        <DiagnosticsBody snapshot={snapshot} log={log} />
        <div className="ptc-modal-actions">
          <button className="ptc-btn-secondary" type="button" onClick={() => { clearDebugLog(); setLog([]); }}>
            Clear log
          </button>
          <button
            className="ptc-btn-secondary"
            type="button"
            onClick={() => {
              const text = JSON.stringify({ snapshot, log: getDebugLog() }, null, 2);
              void navigator.clipboard?.writeText(text);
              Spicetify.showNotification("Diagnostics copied to clipboard", false, 2500);
            }}
          >
            Copy report
          </button>
          <button
            className="ptc-btn-secondary"
            type="button"
            onClick={() => {
              const tracklist = document.querySelector(".main-trackList-indexable");
              const report = captureLayoutReport(tracklist || document.body, "diagnostics-modal", null);
              downloadDebugFile(report);
            }}
          >
            Export layout debug
          </button>
          <button className="ptc-btn-secondary" type="button" disabled={running} onClick={() => void run()}>
            {running ? "Running…" : "Run test"}
          </button>
          <button className="ptc-btn-primary" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
