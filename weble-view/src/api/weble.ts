export type Campaign = Record<string, unknown> & {
  id?: number;
  item?: string;
  media?: string;
  status?: string;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
  category?: unknown;
  thumbnail?: string;
};

type CampaignsResponse = {
  items: Campaign[];
  total?: number;
  count?: number;
  page?: number;
  limit?: number;
  _links?: {
    next?: string;
    last?: string;
  };
};

function toSearchParams(init: Record<string, string | string[] | number | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(init)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      for (const vv of v) sp.append(k, vv);
    } else {
      sp.set(k, String(v));
    }
  }
  return sp;
}

export async function fetchAllCampaignPages(args: {
  cat: string;
  limit: number;
  media: string[];
  sort: string;
  type: string;
  startPage?: number;
  signal?: AbortSignal;
  bearerToken?: string;
}) {
  const startPage = args.startPage ?? 1;
  const baseParams = {
    cat: args.cat,
    limit: args.limit,
    sort: args.sort,
    type: args.type
  };

  const mediaKey = "media[]";
  const all: Campaign[] = [];
  const token = (args.bearerToken ?? "").trim().replace(/^Bearer\s+/i, "");

  let nextPath = `/v1/campaigns?${toSearchParams(baseParams).toString()}&${args.media
    .map((m) => `${encodeURIComponent(mediaKey)}=${encodeURIComponent(m)}`)
    .join("&")}&page=${startPage}`;

  let pagesFetched = 0;
  let totalReported: number | undefined;
  let lastPage: number | undefined;

  while (nextPath) {
    const res = await fetch(nextPath, {
      signal: args.signal,
      headers: token
        ? {
            accept: "application/json, text/plain, */*",
            authorization: `Bearer ${token}`
          }
        : undefined
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
    }

    const json = (await res.json()) as CampaignsResponse;
    all.push(...(Array.isArray(json.items) ? json.items : []));
    pagesFetched += 1;

    if (typeof json.total === "number") totalReported = json.total;
    if (typeof json.limit === "number" && typeof json.total === "number") {
      lastPage = Math.max(1, Math.ceil(json.total / json.limit));
    }

    const next = json._links?.next;
    nextPath = next ? (next.startsWith("http") ? new URL(next).pathname + new URL(next).search : next) : "";
  }

  return {
    items: all,
    pagesFetched,
    totalReported,
    lastPage
  };
}

type StarredsConfirmRaw =
  | Record<string, unknown>
  | Array<unknown>
  | {
      items?: unknown;
    };

export async function fetchStarredsConfirm(args: {
  userId: number;
  campaignIds: number[];
  bearerToken: string;
  signal?: AbortSignal;
}) {
  const ids = Array.from(new Set(args.campaignIds)).filter((n) => Number.isFinite(n));
  if (ids.length === 0) return { starredByCampaignId: {} as Record<number, boolean>, raw: null as unknown };

  const token = args.bearerToken.trim().replace(/^Bearer\s+/i, "");
  const url = `/users/${args.userId}/starreds-confirm?campaigns=${encodeURIComponent(ids.join(","))}`;
  const res = await fetch(url, {
    method: "GET",
    signal: args.signal,
    headers: {
      accept: "application/json, text/plain, */*",
      authorization: `Bearer ${token}`
    }
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}${text ? ` - ${text}` : ""}`);
  }

  const raw = (await res.json().catch(() => null)) as StarredsConfirmRaw | null;

  // We don't know the exact response shape, so parse defensively:
  // - { [campaignId]: true/false }
  // - { items: { [campaignId]: true/false } } or { items: [{campaignId, starred}] }
  // - [{campaignId, starred}] or [campaignId, ...]
  const starredByCampaignId: Record<number, boolean> = {};

  const tryMapObject = (obj: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(obj)) {
      const id = Number(k);
      if (!Number.isFinite(id)) continue;
      if (typeof v === "boolean") starredByCampaignId[id] = v;
    }
  };

  const tryArray = (arr: unknown[]) => {
    for (const v of arr) {
      if (typeof v === "number" && Number.isFinite(v)) {
        starredByCampaignId[v] = true;
        continue;
      }
      if (v && typeof v === "object") {
        const anyV = v as Record<string, unknown>;
        const id =
          typeof anyV.campaignId === "number"
            ? anyV.campaignId
            : typeof anyV.id === "number"
              ? anyV.id
              : undefined;
        const starred =
          typeof anyV.starred === "boolean"
            ? anyV.starred
            : typeof anyV.isStarred === "boolean"
              ? anyV.isStarred
              : undefined;
        if (typeof id === "number" && Number.isFinite(id) && typeof starred === "boolean") {
          starredByCampaignId[id] = starred;
        }
      }
    }
  };

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (obj.items && Array.isArray(obj.items)) tryArray(obj.items);
    else if (obj.items && typeof obj.items === "object") tryMapObject(obj.items as Record<string, unknown>);
    else tryMapObject(obj);
  } else if (Array.isArray(raw)) {
    tryArray(raw);
  }

  return { starredByCampaignId, raw };
}

