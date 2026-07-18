import type { TrackMeta } from "./types";
import { debugLog } from "./debug";
import { summarizeBatch } from "./diagnostics";
import { formatDjKey, fetchAudioFeatures } from "./dj-metadata";
import { fetchPopularityBatch } from "./extended-metadata";
import { getSettings } from "./settings";

let metadataServiceClient: { fetch: (req: unknown) => Promise<ExtensionResponse> } | null = null;
const trackCache = new Map<string, TrackMeta>();
let tokenRefresh: Promise<string | null> | null = null;

interface ExtensionResponse {
  extension?: {
    extensionKind?: number;
    entityExtension?: {
      entityUri: string;
      extensionData?: { value: Record<string, number> | Uint8Array };
    }[];
  }[];
}

interface InternalTrackBody {
  name?: string;
  popularity?: number;
  duration?: number;
  artist?: { name: string }[];
  album?: { name: string };
}

function getWebpackService(id: string) {
  const req = (window as unknown as { webpackChunkclient_web: unknown[] }).webpackChunkclient_web.push([
    [Symbol()],
    {},
    (r: unknown) => r,
  ]) as { m: Record<string, unknown> };
  return Object.values(req.m)
    .flatMap((m) => {
      try {
        const key = Object.keys(req.m).find((k) => req.m[k] === m);
        return key ? Object.values((req as unknown as (k: string) => Record<string, unknown>)(key)) : [];
      } catch {
        return [];
      }
    })
    .find((c) => (c as { SERVICE_ID?: string })?.SERVICE_ID === id);
}

function spotifyHex(base62: string) {
  const invalid = "00000000000000000000000000000000";
  if (!base62 || base62.length > 22) return invalid;
  const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let val = BigInt(0);
  for (const ch of base62) {
    const idx = chars.indexOf(ch);
    if (idx === -1) return invalid;
    val = val * BigInt(62) + BigInt(idx);
  }
  return val.toString(16).padStart(32, "0");
}

function extensionBytes(value: Record<string, number> | Uint8Array) {
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(Object.values(value));
}

function parseVarint(obj: Record<string, number>) {
  const bytes = Object.values(obj);
  let res = 0n;
  let shift = 0n;
  for (let i = 1; i < bytes.length; i++) {
    res += BigInt(bytes[i] & 0x7f) << shift;
    if (!(bytes[i] & 0x80)) break;
    shift += 7n;
  }
  return Number(res);
}

function getMetadataClient() {
  if (metadataServiceClient) return metadataServiceClient;
  try {
    const MetadataService = getWebpackService("spotify.mdata_esperanto.proto.MetadataService") as new (
      transport: unknown
    ) => typeof metadataServiceClient;
    const transport = Spicetify.Platform?.ProductStateAPI?.productStateApi?.transport;
    if (!MetadataService || !transport) return null;
    metadataServiceClient = new MetadataService(transport);
  } catch (e) {
    console.error("[Playlist Columns] MetadataService init failed", e);
  }
  return metadataServiceClient;
}

async function waitForMetadataClient(attempts = 20) {
  for (let i = 0; i < attempts; i++) {
    const client = getMetadataClient();
    if (client) return client;
    await new Promise((r) => setTimeout(r, 200));
  }
  console.warn("[Playlist Columns] MetadataService unavailable after wait");
  return null;
}

async function getAccessToken(): Promise<string | null> {
  try {
    const auth = Spicetify.Platform.AuthorizationAPI?.getState?.();
    if (auth?.token?.accessToken) return auth.token.accessToken;
  } catch {
    // not ready
  }
  if (Spicetify.Platform.Session?.accessToken) return Spicetify.Platform.Session.accessToken;
  try {
    const tokenData = await Spicetify.CosmosAsync.get("sp://auth/v2/token");
    if (tokenData?.accessToken) {
      if (Spicetify.Platform.Session) Spicetify.Platform.Session.accessToken = tokenData.accessToken;
      return tokenData.accessToken;
    }
  } catch (e) {
    console.warn("[Playlist Columns] Token fetch failed", e);
  }
  return null;
}

async function refreshAccessToken() {
  if (tokenRefresh) return tokenRefresh;
  tokenRefresh = (async () => {
    try {
      const tokenData = await Spicetify.CosmosAsync.get("sp://auth/v2/token");
      if (tokenData?.accessToken) {
        if (Spicetify.Platform.Session) Spicetify.Platform.Session.accessToken = tokenData.accessToken;
        return tokenData.accessToken as string;
      }
    } catch (e) {
      console.warn("[Playlist Columns] Token refresh failed", e);
    }
    return null;
  })().finally(() => {
    tokenRefresh = null;
  });
  return tokenRefresh;
}

async function spclientGet<T>(url: string): Promise<T | null> {
  try {
    return (await Spicetify.CosmosAsync.get(url)) as T;
  } catch (e) {
    console.warn("[Playlist Columns] CosmosAsync failed", url, e);
    return null;
  }
}

async function spclientFetch(url: string): Promise<Response | null> {
  let token = await getAccessToken();
  if (!token) return null;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (Spicetify.Platform?.version) headers["Spotify-App-Version"] = Spicetify.Platform.version;
  const platform = Spicetify.Platform?.PlatformData?.app_platform;
  if (platform) headers["App-Platform"] = platform;

  let res = await fetch(url, { headers });
  if (res.status === 401) {
    token = await refreshAccessToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
      res = await fetch(url, { headers });
    }
  }
  return res;
}

async function fetchInternalTrackMetadata(trackId: string): Promise<InternalTrackBody | null> {
  const url = `https://spclient.wg.spotify.com/metadata/4/track/${spotifyHex(trackId)}?market=from_token&alt=json`;
  const fromCosmos = await spclientGet<InternalTrackBody>(url);
  if (fromCosmos && (fromCosmos.name != null || fromCosmos.popularity != null)) return fromCosmos;

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await spclientFetch(url);
    if (!res) return null;
    if (res.status === 401) {
      await refreshAccessToken();
      continue;
    }
    if (!res.ok) {
      console.warn("[Playlist Columns] Internal track metadata failed", trackId, res.status);
      return null;
    }
    return (await res.json()) as InternalTrackBody;
  }
  return null;
}

async function fetchPlayCounts(uris: string[]) {
  const client = await waitForMetadataClient();
  if (!client) return new Map<string, number>();
  const valid = uris.filter((u) => u.startsWith("spotify:track:"));
  if (!valid.length) return new Map();

  const results = new Map<string, number>();
  for (let i = 0; i < valid.length; i += 500) {
    const batch = valid.slice(i, i + 500);
    try {
      const response = await client.fetch({
        extensionQuery: [{ extensionKind: 185, entityUri: batch }],
      });
      response.extension?.[0]?.entityExtension?.forEach((item) => {
        if (item.extensionData?.value && typeof item.extensionData.value === "object") {
          results.set(item.entityUri, parseVarint(item.extensionData.value as Record<string, number>));
        }
      });
    } catch (e) {
      console.warn("[Playlist Columns] Play count batch failed", e);
    }
  }
  return results;
}

async function fetchWebApiTracks(ids: string[]) {
  const tracks: { id: string; uri: string; name: string; popularity?: number; duration_ms?: number; artists?: { name: string }[]; album?: { name: string } }[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    try {
      const data = (await Spicetify.CosmosAsync.get(
        `https://api.spotify.com/v1/tracks?ids=${chunk.join(",")}`
      )) as { tracks?: (typeof tracks)[number][] };
      tracks.push(...(data?.tracks || []).filter(Boolean));
    } catch (e) {
      console.warn("[Playlist Columns] Web API tracks failed", e);
      const res = await spclientFetch(`https://api.spotify.com/v1/tracks?ids=${chunk.join(",")}`);
      if (res?.ok) {
        const data = await res.json();
        tracks.push(...((data.tracks as typeof tracks) || []).filter(Boolean));
      }
    }
  }
  return tracks;
}

interface GraphQLTrackData {
  playcount?: number;
  popularity?: number;
}

async function fetchGraphQLTrackData(uris: string[]) {
  const results = new Map<string, GraphQLTrackData>();
  const def = Spicetify.GraphQL.Definitions.getTrack;
  if (!def) return results;
  await Promise.all(
    uris.map(async (uri) => {
      try {
        const res = await Spicetify.GraphQL.Request(def, { uri });
        const tu = res?.data?.trackUnion;
        if (!tu) return;
        const entry: GraphQLTrackData = {};
        if (tu.playcount != null) entry.playcount = parseInt(String(tu.playcount), 10) || 0;
        if (tu.popularity != null) entry.popularity = Number(tu.popularity);
        results.set(uri, entry);
      } catch {
        // per-track
      }
    })
  );
  return results;
}

function parseNativeGenresFromExtension(ext: ExtensionResponse["extension"]) {
  const byUri = new Map<string, string[]>();
  if (!ext) return byUri;

  const batch = new Map<string, { concepts: string[]; scores: number[] }>();
  const ensure = (uri: string) => batch.get(uri) || { concepts: [], scores: [] };

  for (const block of ext) {
    const kind = block.extensionKind;
    if (kind !== 6 && kind !== 28) continue;
    for (const item of block.entityExtension || []) {
      if (!item.extensionData?.value) continue;
      const uri = item.entityUri;
      const entry = ensure(uri);
      const bytes = extensionBytes(item.extensionData.value);

      if (kind === 6) {
        const text = new TextDecoder().decode(bytes);
        const raw = text.match(/[A-Za-z0-9 _\-&']{3,}/g);
        if (raw) {
          const matches = raw.filter((s) => {
            const l = s.toLowerCase();
            return !l.startsWith("spotify") && !l.startsWith("&spotify") && l !== "concept";
          });
          for (let j = 0; j < matches.length; j++) {
            if (/^[a-zA-Z0-9]{22}$/.test(matches[j]) && j > 0) {
              const concept = matches[j - 1].trim();
              if (concept.toLowerCase() !== "track") entry.concepts.push(concept);
            }
          }
        }
      } else {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let i = 0; i < bytes.byteLength - 8; i++) {
          try {
            const val = view.getFloat64(i, true);
            if (val > 0.001 && val <= 1) entry.scores.push(val);
          } catch {
            // skip
          }
        }
      }
      batch.set(uri, entry);
    }
  }

  batch.forEach((data, uri) => {
    const ranked = new Map<string, number>();
    data.concepts.forEach((name, i) => {
      const key = name.toLowerCase();
      const score = data.scores[i] ?? 0;
      if (!ranked.has(key) || (ranked.get(key) ?? 0) < score) ranked.set(key, score);
    });
    const genres = [...ranked.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name.replace(/\b\w/g, (c) => c.toUpperCase()));
    if (genres.length) byUri.set(uri, genres);
  });

  return byUri;
}

async function fetchTrackGenresBatch(uris: string[]) {
  const client = await waitForMetadataClient();
  const results = new Map<string, string[]>();
  if (!client) return results;

  const valid = uris.filter((u) => u.startsWith("spotify:track:"));
  for (let i = 0; i < valid.length; i += 500) {
    const batch = valid.slice(i, i + 500);
    try {
      const response = await client.fetch({
        extensionQuery: [
          { extensionKind: 6, entityUri: batch },
          { extensionKind: 28, entityUri: batch },
        ],
      });
      const parsed = parseNativeGenresFromExtension(response.extension);
      parsed.forEach((genres, uri) => results.set(uri, genres));
    } catch (e) {
      console.warn("[Playlist Columns] Genre batch failed", e);
    }
  }
  return results;
}

function trackIdFromUri(uri: string) {
  return uri?.split(":")[2] || null;
}

function emptyMeta(uri: string, complete = false): TrackMeta {
  return {
    uri,
    title: "",
    artist: "",
    album: "",
    popularity: null,
    plays: null,
    genres: [],
    complete,
  };
}

export function formatPlays(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatGenre(genres: string[]) {
  if (!genres?.length) return "—";
  return genres.slice(0, 2).join(", ");
}

export function getTrackMeta(uri: string) {
  return trackCache.get(uri);
}

export function getTrackCache() {
  return trackCache;
}

export function applyPlaylistContext(items: { uri?: string; addedAt?: string }[]) {
  for (const item of items) {
    if (!item.uri) continue;
    const addedAtMs = item.addedAt ? new Date(item.addedAt).getTime() : undefined;
    if (!addedAtMs || Number.isNaN(addedAtMs)) continue;
    const existing = trackCache.get(item.uri);
    if (existing) {
      existing.dateAddedMs = addedAtMs;
    } else {
      trackCache.set(item.uri, { ...emptyMeta(item.uri, false), dateAddedMs: addedAtMs });
    }
  }
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function ensureTrackMetadata(uris: string[]) {
  const missing = uris.filter((u) => u && !trackCache.get(u)?.complete);
  if (!missing.length) return;

  const trackUris = missing.filter((u) => u.startsWith("spotify:track:"));
  missing
    .filter((u) => u.startsWith("spotify:local:"))
    .forEach((uri) => trackCache.set(uri, emptyMeta(uri, true)));

  if (!trackUris.length) return;

  const trackIds = [...new Set(trackUris.map(trackIdFromUri).filter((id): id is string => Boolean(id)))];
  const needDj = getSettings().columns.dj !== false;

  const [playCounts, genreMap, popularityMap, webTracks, audioFeatures] = await Promise.all([
    fetchPlayCounts(trackUris),
    fetchTrackGenresBatch(trackUris),
    fetchPopularityBatch(trackUris),
    fetchWebApiTracks(trackIds),
    needDj ? fetchAudioFeatures(trackIds) : Promise.resolve(new Map()),
  ]);

  const webById = new Map(webTracks.map((t) => [t.id, t]));
  const webByUri = new Map(webTracks.map((t) => [t.uri || `spotify:track:${t.id}`, t]));

  const missingPlays = trackUris.filter((u) => !playCounts.has(u));
  const gqlData = missingPlays.length ? await fetchGraphQLTrackData(missingPlays) : new Map();
  gqlData.forEach((data, uri) => {
    if (data.playcount != null) playCounts.set(uri, data.playcount);
    if (data.popularity != null && !popularityMap.has(uri)) popularityMap.set(uri, data.popularity);
  });

  const missingPopularity = trackUris.filter((u) => !popularityMap.has(u));
  const internals =
    missingPopularity.length > 0
      ? await mapPool(
          [...new Set(missingPopularity.map(trackIdFromUri).filter((id): id is string => Boolean(id)))],
          12,
          async (id) => ({ id, body: await fetchInternalTrackMetadata(id) })
        )
      : [];
  const internalById = new Map(internals.map((x) => [x.id, x.body]));

  let filled = 0;
  for (const uri of trackUris) {
    const id = trackIdFromUri(uri);
    if (!id) continue;

    const web = webByUri.get(uri) || webById.get(id);
    const internal = internalById.get(id);
    const popularity =
      popularityMap.get(uri) ?? web?.popularity ?? internal?.popularity ?? null;
    const plays = playCounts.get(uri) ?? null;
    const genres = genreMap.get(uri) || [];
    const audio = audioFeatures.get(id);
    const djKey = audio ? formatDjKey(audio.key ?? -1, audio.mode ?? -1) : null;
    const djBpm = audio?.tempo ?? null;

    if (popularity != null || plays != null || genres.length > 0 || djBpm != null) filled++;

    trackCache.set(uri, {
      uri,
      id,
      title: web?.name || internal?.name || trackCache.get(uri)?.title || "",
      artist:
        web?.artists?.map((a) => a.name).join(", ") ||
        internal?.artist?.map((a) => a.name).join(", ") ||
        trackCache.get(uri)?.artist ||
        "",
      album: web?.album?.name || internal?.album?.name || trackCache.get(uri)?.album || "",
      popularity,
      plays,
      genres,
      djKey,
      djBpm,
      durationMs: web?.duration_ms || internal?.duration,
      dateAddedMs: trackCache.get(uri)?.dateAddedMs,
      complete: true,
    });
  }

  if (filled === 0 && trackUris.length > 0) {
    debugLog(`batch empty for ${trackUris.length} tracks`);
    console.warn(
      "[Playlist Columns] No metadata loaded for batch — open Columns → Diagnostics"
    );
  }

  summarizeBatch(trackUris.length, {
    popularity: trackUris.filter((u) => (trackCache.get(u)?.popularity ?? null) != null).length,
    plays: trackUris.filter((u) => (trackCache.get(u)?.plays ?? null) != null).length,
    genres: trackUris.filter((u) => (trackCache.get(u)?.genres?.length ?? 0) > 0).length,
  });
}
