import { serverApiUrlFromEnv } from "@/lib/public-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Chat SSE and mission runs can outlive the default function timeout.
export const maxDuration = 300;

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "cookie",
]);

type RouteContext = { params: Promise<{ path: string[] }> };

async function proxy(request: Request, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  const destBase = serverApiUrlFromEnv();
  const suffix = path.join("/");
  const search = new URL(request.url).search;
  const dest = `${destBase}/${suffix}${search}`;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
    signal: request.signal,
  };
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    // Buffer rather than stream: OpenNext on workerd does not reliably
    // forward a Request body with duplex:"half", and a dropped POST is
    // how publish / missions / document upload look "stubbed".
    const buf = await request.arrayBuffer();
    if (buf.byteLength > 0) {
      init.body = buf;
    }
  }

  const upstream = await fetch(dest, init);
  const outHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      outHeaders.set(key, value);
    }
  });
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
