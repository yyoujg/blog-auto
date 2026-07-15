export type ReviewnoteRow = Record<string, unknown>;

function withRnApiBase(path: string) {
  if (typeof import.meta !== "undefined" && (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) {
    return `/rn${path.startsWith("/") ? path : `/${path}`}`;
  }
  return `/api/reviewnote${path.startsWith("/") ? path : `/${path}`}`;
}

function extractArray(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== "object") return [];
  const o = json as Record<string, unknown>;
  for (const k of ["content", "items", "data", "campaigns", "result", "list"]) {
    const v = o[k];
    if (Array.isArray(v)) return v;
  }
  return [];
}

function extractTotal(json: unknown): number | undefined {
  if (!json || typeof json !== "object") return undefined;
  const o = json as Record<string, unknown>;
  for (const k of ["totalElements", "total", "totalCount", "count"]) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

function toRow(x: unknown): ReviewnoteRow {
  if (x && typeof x === "object" && !Array.isArray(x)) return x as ReviewnoteRow;
  return { value: x } as ReviewnoteRow;
}

function rowDedupKey(r: ReviewnoteRow, seq: number): string {
  const id = r.id ?? r.campaignId;
  if (typeof id === "number" && Number.isFinite(id)) return `n:${id}`;
  if (typeof id === "string" && id.trim()) return `s:${id.trim()}`;
  return `_seq_${seq}`;
}

export function rnTitle(r: ReviewnoteRow): string {
  const v = r.item ?? r.title ?? r.name ?? r.campaignName ?? r.productName ?? r.campaignTitle ?? r.productTitle;
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

export function rnThumb(r: ReviewnoteRow): string {
  const v =
    r.thumbnail ??
    r.thumbUrl ??
    r.imageUrl ??
    r.image ??
    r.coverImage ??
    r.imgSrc ??
    (isPlain(r.bannerImage) ? (r.bannerImage as Record<string, unknown>).url : r.bannerImage);
  if (typeof v === "string") return v;
  return "";
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export function rnNumericId(r: ReviewnoteRow): number | null {
  const v = r.id ?? r.campaignId;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

let cachedBuildId: string | null = null;

async function getReviewnoteBuildId(cookie: string, signal?: AbortSignal): Promise<string> {
  if (cachedBuildId) return cachedBuildId;
  const res = await fetch(withRnApiBase("/campaigns"), {
    method: "GET",
    signal,
    headers: { accept: "text/html,*/*", "x-reviewnote-cookie": cookie }
  });
  const html = await res.text();
  const m = html.match(/"buildId":"([^"]+)"/);
  if (!m) throw new Error("리뷰노트 buildId를 찾지 못했습니다.");
  cachedBuildId = m[1];
  return cachedBuildId;
}

export async function fetchReviewnoteCampaignDetail(args: {
  id: number;
  cookie: string;
  signal?: AbortSignal;
}): Promise<Record<string, unknown>> {
  const cookie = args.cookie.trim();
  if (!cookie) throw new Error("리뷰노트 쿠키가 비어 있습니다.");

  const attempt = async () => {
    const buildId = await getReviewnoteBuildId(cookie, args.signal);
    const url = withRnApiBase(`/_next/data/${buildId}/campaigns/${args.id}.json?id=${args.id}`);
    const res = await fetch(url, {
      method: "GET",
      signal: args.signal,
      headers: { accept: "application/json, text/plain, */*", "x-reviewnote-cookie": cookie }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return (await res.json()) as Record<string, unknown>;
  };

  let json: Record<string, unknown>;
  try {
    json = await attempt();
  } catch {
    // buildId가 오래되면 404/파싱 실패 -> 재탐지 후 1회 재시도
    cachedBuildId = null;
    json = await attempt();
  }

  const pageProps = (json as { pageProps?: unknown }).pageProps;
  if (isPlain(pageProps)) return pageProps as Record<string, unknown>;
  return json;
}

export async function fetchAllReviewnoteCampaignPages(args: {
  channel: string;
  sort: string;
  limit: number;
  startPage?: number;
  cookie: string;
  signal?: AbortSignal;
}) {
  const limit = Math.max(1, Math.min(100, args.limit));
  const startPage = Math.max(0, args.startPage ?? 0);
  const cookie = args.cookie.trim();
  if (!cookie) throw new Error("리뷰노트 쿠키가 비어 있습니다.");

  const all: ReviewnoteRow[] = [];
  let pagesFetched = 0;
  let totalReported: number | undefined;
  let lastPage: number | undefined;

  const maxPages = 200;

  for (let page = startPage; page < startPage + maxPages; page += 1) {
    const qs = new URLSearchParams({
      channel: args.channel,
      sort: args.sort,
      gugunSelected: "",
      s: "default",
      limit: String(limit),
      page: String(page),
      _: String(Date.now())
    });
    const url = withRnApiBase(`/api/v2/campaigns?${qs.toString()}`);

    const res = await fetch(url, {
      method: "GET",
      signal: args.signal,
      headers: {
        accept: "application/json, text/plain, */*",
        "x-reviewnote-cookie": cookie
      }
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText}${text ? ` - ${text.slice(0, 400)}` : ""}`);
    }

    const json = (await res.json().catch(() => null)) as unknown;
    const batch = extractArray(json).map(toRow);
    pagesFetched += 1;

    if (typeof totalReported !== "number") {
      const t = extractTotal(json);
      if (typeof t === "number") totalReported = t;
    }
    if (typeof totalReported === "number" && limit > 0) {
      lastPage = Math.max(0, Math.ceil(totalReported / limit) - 1);
    }

    if (batch.length === 0) break;

    all.push(...batch);

    if (batch.length < limit) break;
    if (typeof totalReported === "number" && all.length >= totalReported) break;
  }

  const seen = new Map<string, ReviewnoteRow>();
  let seq = 0;
  for (const r of all) {
    const k = rowDedupKey(r, seq++);
    if (!seen.has(k)) seen.set(k, r);
  }
  const items = Array.from(seen.values());

  return {
    items,
    pagesFetched,
    totalReported,
    lastPage
  };
}
