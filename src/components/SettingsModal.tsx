import React from "react";
import { CUSTOM_COLUMNS, DEFAULT_SETTINGS } from "../lib/constants";
import type { ColumnId, NativeColumnKey, PtcSettings, SortDirection } from "../lib/types";

interface Props {
  initial: PtcSettings;
  onSave: (settings: PtcSettings) => void;
  onClose: () => void;
}

export function SettingsModal({ initial, onSave, onClose }: Props) {
  const [state, setState] = React.useState(initial);

  const toggle = (group: "columns" | "native", key: ColumnId | NativeColumnKey) => {
    setState((s) => ({ ...s, [group]: { ...s[group], [key]: !s[group][key as keyof typeof s[typeof group]] } }));
  };

  return (
    <div className="ptc-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ptc-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Playlist Columns</h2>
        <p>
          Choose visible columns and default sort. Sorting reorders the playlist (restorable via the sort pill) without
          leaving the page.
        </p>

        <div className="ptc-section">
          <h3>Custom columns</h3>
          <p className="ptc-section-hint">Uncheck a column to hide it from the track list.</p>
          {CUSTOM_COLUMNS.map((col) => (
            <label className="ptc-checkbox-row" key={col.id}>
              <input
                type="checkbox"
                checked={state.columns[col.id] !== false}
                onChange={() => toggle("columns", col.id)}
              />
              {col.label}
            </label>
          ))}
        </div>

        <div className="ptc-section">
          <h3>DJ column</h3>
          <p className="ptc-section-hint">Built-in key and BPM — disable the separate DJ Info extension to avoid conflicts.</p>
          <label className="ptc-checkbox-row">
            <input
              type="checkbox"
              checked={state.dj.camelot}
              onChange={() => setState((s) => ({ ...s, dj: { ...s.dj, camelot: !s.dj.camelot } }))}
            />
            Camelot notation (3B, 8A, …)
          </label>
          <label className="ptc-checkbox-row">
            <input
              type="checkbox"
              checked={state.dj.showBpm}
              onChange={() => setState((s) => ({ ...s, dj: { ...s.dj, showBpm: !s.dj.showBpm } }))}
            />
            Show BPM
          </label>
        </div>

        <div className="ptc-section">
          <h3>Spotify columns</h3>
          {(
            [
              ["artist", "Artist"],
              ["album", "Album"],
              ["dateAdded", "Date added"],
            ] as [NativeColumnKey, string][]
          ).map(([key, label]) => (
            <label className="ptc-checkbox-row" key={key}>
              <input type="checkbox" checked={state.native[key]} onChange={() => toggle("native", key)} />
              {label}
            </label>
          ))}
        </div>

        <div className="ptc-section">
          <h3>Default sort</h3>
          <div className="ptc-select-row">
            <select
              value={state.defaultSort.column || ""}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  defaultSort: { ...s.defaultSort, column: (e.target.value || null) as PtcSettings["defaultSort"]["column"] },
                }))
              }
            >
              <option value="">None</option>
              {CUSTOM_COLUMNS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <select
              value={state.defaultSort.direction}
              onChange={(e) =>
                setState((s) => ({
                  ...s,
                  defaultSort: { ...s.defaultSort, direction: e.target.value as SortDirection },
                }))
              }
            >
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </div>
        </div>

        <div className="ptc-modal-actions">
          <button className="ptc-btn-secondary" type="button" onClick={() => setState(structuredClone(DEFAULT_SETTINGS))}>
            Reset defaults
          </button>
          <button className="ptc-btn-secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="ptc-btn-primary"
            type="button"
            onClick={() => {
              onSave(state);
              onClose();
              Spicetify.showNotification("Playlist Columns settings saved", false, 2000);
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

