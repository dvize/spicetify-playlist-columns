import { getSettings } from "./settings";

export interface DjAudioFeatures {
  tempo?: number;
  key?: number;
  mode?: number;
}

export function getKeyLabel(key: number, mode: number, camelot: boolean) {
  const camelotKey =
    key < 0 || mode < 0 ? "—" : `${((7 * key + [4, 7][mode]) % 12) + 1}${"AB"[mode]}`;
  const standardKey =
    key < 0 ? "—" : `${"C Db D Eb E F F♯ G Ab A Bb B".split(" ")[key]}${["m", "", "?"][mode] ?? ""}`;

  if (camelot) return camelotKey;
  return standardKey;
}

export async function fetchAudioFeatures(ids: string[]) {
  const results = new Map<string, DjAudioFeatures>();
  if (!ids.length) return results;

  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    try {
      const data = (await Spicetify.CosmosAsync.get(
        `https://spclient.wg.spotify.com/audio-attributes/v1/audio-features?ids=${chunk.join(",")}`
      )) as { audio_features?: { id: string; tempo?: number; key?: number; mode?: number }[] };
      for (const f of data?.audio_features || []) {
        if (!f?.id) continue;
        results.set(f.id, { tempo: f.tempo, key: f.key, mode: f.mode });
      }
    } catch (e) {
      console.warn("[Playlist Columns] audio-features failed", e);
    }
  }
  return results;
}

export function formatDjKey(key?: number, mode?: number) {
  if (key == null || mode == null) return null;
  const settings = getSettings();
  return getKeyLabel(key, mode, settings.dj.camelot);
}
