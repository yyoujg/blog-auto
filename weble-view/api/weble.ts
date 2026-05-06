type AnyReq = {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  query?: Record<string, unknown>;
};

type AnyRes = {
  status: (code: number) => AnyRes;
  setHeader: (name: string, value: string) => void;
  send: (body: string | Buffer) => void;
  end: (body?: string | Buffer) => void;
};

export default async function handler(req: AnyReq, res: AnyRes) {
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "OPTIONS") {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET,OPTIONS");
    res.setHeader("access-control-allow-headers", "authorization,content-type,accept");
    return res.status(204).end();
  }
  if (method !== "GET") return res.status(405).send("Method Not Allowed");

  const q = req.query ?? {};
  const rawPath = q.path;
  const path = typeof rawPath === "string" ? rawPath : Array.isArray(rawPath) ? String(rawPath[0] ?? "") : "";
  const pathnameRaw = path || "/";
  const pathname = pathnameRaw.startsWith("/") ? pathnameRaw : `/${pathnameRaw}`;

  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (k === "path") continue;
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const vv of v) sp.append(k, String(vv));
    } else {
      sp.append(k, String(v));
    }
  }

  const targetUrl = `https://api.weble.net${pathname}${sp.toString() ? `?${sp.toString()}` : ""}`;

  const headersIn = req.headers ?? {};
  const authRaw = headersIn.authorization;
  const authorization = Array.isArray(authRaw) ? authRaw[0] : authRaw;

  const upstream = await fetch(targetUrl, {
    method: "GET",
    headers: {
      accept: "application/json, text/plain, */*",
      ...(authorization ? { authorization } : {}),
      origin: "https://www.revu.net",
      referer: "https://www.revu.net/"
    }
  }).catch((e) => {
    return { ok: false, status: 502, statusText: String(e), text: async () => "" } as unknown as Response;
  });

  res.setHeader("access-control-allow-origin", "*");

  const contentType = upstream.headers?.get?.("content-type");
  if (contentType) res.setHeader("content-type", contentType);

  const body = await upstream.text().catch(() => "");
  return res.status(upstream.status || 502).send(body);
}

