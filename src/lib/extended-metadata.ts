const extendedMetadataJsonDescriptor = {
  nested: {
    Message: {
      fields: {
        header: { type: "Header", id: 1 },
        request: { type: "Request", id: 2, rule: "repeated" },
      },
    },
    Header: {
      fields: {
        country: { type: "string", id: 1 },
        catalogue: { type: "string", id: 2 },
        task_id: { type: "bytes", id: 3 },
      },
    },
    Request: {
      fields: {
        entity_uri: { type: "string", id: 1 },
        query: { type: "Query", id: 2 },
      },
    },
    Query: {
      fields: {
        extension_kind: { type: "uint32", id: 1 },
      },
    },
  },
};

const trackMetadataJsonDescriptor = {
  nested: {
    Message: {
      fields: {
        header: { type: "Header", id: 1 },
        extension_kind: { type: "uint32", id: 2 },
        response: { type: "Response", id: 3, rule: "repeated" },
      },
    },
    Header: {
      fields: {
        status: { type: "uint32", id: 1 },
      },
    },
    Response: {
      fields: {
        info: { type: "ResponseInfo", id: 1 },
        track: { type: "string", id: 2 },
        metadata: { type: "TrackMetadataWrapper", id: 3, rule: "optional" },
      },
    },
    ResponseInfo: {
      fields: {
        status: { type: "uint32", id: 1 },
      },
    },
    TrackMetadataWrapper: {
      fields: {
        typestr: { type: "string", id: 1 },
        metadata: { type: "TrackMetadata", id: 2 },
      },
    },
    TrackMetadata: {
      fields: {
        gid: { type: "bytes", id: 1 },
        name: { type: "string", id: 2 },
        album: { type: "AlbumMetadata", id: 3 },
        artist: { type: "Artist", id: 4, rule: "repeated" },
        track_num: { type: "sint32", id: 5 },
        disc_num: { type: "sint32", id: 6 },
        duration_ms: { type: "sint32", id: 7 },
        popularity: { type: "sint32", id: 8 },
      },
    },
    AlbumMetadata: {
      fields: {
        gid: { type: "bytes", id: 1 },
        name: { type: "string", id: 2 },
        artist: { type: "Artist", id: 3, rule: "repeated" },
        release_date: { type: "Date", id: 6, rule: "optional" },
      },
    },
    Artist: {
      fields: {
        gid: { type: "bytes", id: 1 },
        name: { type: "string", id: 2 },
      },
    },
    Date: {
      fields: {
        year: { type: "sint32", id: 1 },
        month: { type: "sint32", id: 2, rule: "optional" },
        day: { type: "sint32", id: 3, rule: "optional" },
      },
    },
  },
};

let requestType: { encode: (msg: unknown) => { finish: () => Uint8Array } } | null = null;
let responseType: { decode: (bytes: Uint8Array) => unknown } | null = null;
let productState: { country: string; catalogue: string } | null = null;

interface ProtobufRoot {
  Root: { fromJSON: (json: unknown) => { lookup: (name: string) => typeof requestType } };
}

async function ensureProductState() {
  if (productState) return productState;
  try {
    const values = await Spicetify.Platform.ProductStateAPI.getValues();
    productState = {
      country: values?.country || "US",
      catalogue: values?.catalogue || "premium",
    };
  } catch {
    productState = { country: "US", catalogue: "premium" };
  }
  return productState;
}

function getProtobufTypes() {
  const pb = (globalThis as { protobuf?: ProtobufRoot }).protobuf;
  if (!pb?.Root) return null;
  if (!requestType) {
    requestType = pb.Root.fromJSON(extendedMetadataJsonDescriptor).lookup("Message");
    responseType = pb.Root.fromJSON(trackMetadataJsonDescriptor).lookup("Message");
  }
  return { requestType, responseType };
}

function getAuthToken() {
  try {
    return Spicetify.Platform.AuthorizationAPI?.getState?.()?.token?.accessToken || null;
  } catch {
    return null;
  }
}

async function waitForAuthToken(attempts = 25) {
  for (let i = 0; i < attempts; i++) {
    const token = getAuthToken();
    if (token) return token;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

async function postExtendedMetadata(uris: string[], extensionKind: number) {
  const types = getProtobufTypes();
  if (!types) return null;
  const token = await waitForAuthToken();
  if (!token) return null;

  const state = await ensureProductState();
  const taskId = new Uint8Array(16);
  crypto.getRandomValues(taskId);

  const body = types.requestType.encode({
    header: { country: state.country, catalogue: state.catalogue, task_id: taskId },
    request: uris.map((entity_uri) => ({ entity_uri, query: { extension_kind: extensionKind } })),
  }).finish();

  const headers: Record<string, string> = {
    "Content-Type": "application/protobuf",
    Authorization: `Bearer ${token}`,
  };
  if (Spicetify.Platform?.version) headers["Spotify-App-Version"] = Spicetify.Platform.version;
  const platform = Spicetify.Platform?.PlatformData?.app_platform;
  if (platform) headers["App-Platform"] = platform;

  const res = await fetch("https://spclient.wg.spotify.com/extended-metadata/v0/extended-metadata", {
    method: "POST",
    body,
    headers,
  });
  if (!res.ok) {
    console.warn("[Playlist Columns] extended-metadata failed", res.status);
    return null;
  }
  return new Uint8Array(await res.arrayBuffer());
}

export async function fetchPopularityBatch(uris: string[]) {
  const results = new Map<string, number>();
  const valid = uris.filter((u) => u.startsWith("spotify:track:"));
  if (!valid.length) return results;

  for (let i = 0; i < valid.length; i += 100) {
    const batch = valid.slice(i, i + 100);
    try {
      const bytes = await postExtendedMetadata(batch, 10);
      const types = getProtobufTypes();
      if (!bytes || !types) continue;
      const decoded = types.responseType.decode(bytes) as {
        response?: { track?: string; metadata?: { metadata?: { popularity?: number; name?: string; duration_ms?: number; artist?: { name: string }[]; album?: { name: string } } } }[];
      };
      for (const item of decoded.response || []) {
        if (!item.track || !item.metadata?.metadata) continue;
        const meta = item.metadata.metadata;
        if (meta.popularity != null) results.set(item.track, meta.popularity);
      }
    } catch (e) {
      console.warn("[Playlist Columns] Popularity batch failed", e);
    }
  }
  return results;
}
