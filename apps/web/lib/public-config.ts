export type PublicConfig = {
  apiUrl: string;
  demoLogin: boolean;
  googleLogin: boolean;
};

declare global {
  interface Window {
    __AGENTFLEET_API_URL__?: string;
  }
}

/**
 * Browser-facing API origin.
 *
 * Default is the same-origin `/backend` proxy (see
 * `app/backend/[...path]/route.ts`). That is the hosted-demo default so
 * client pages (missions, builder, evals, documents) never depend on a
 * build-time `NEXT_PUBLIC_API_URL` (which silently becomes
 * `http://localhost:8000` and is the other half of "only Chat works").
 *
 * Set PUBLIC_API_URL only when the browser must call the API host
 * directly (and then CORS_ORIGINS on the API must include this web origin).
 * Loopback / docker hostnames are rejected so a leftover .env line cannot
 * re-break hosted client pages. Never put INTERNAL_API_URL here.
 */
export function isUnsafeBrowserApiUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith("/")) return false;
  let host = "";
  try {
    host = new URL(trimmed).hostname.toLowerCase();
  } catch {
    return true;
  }
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host === "api" ||
    host === "host.docker.internal" ||
    host.endsWith(".internal")
  );
}

export function browserApiUrlFromEnv(): string {
  const explicit = process.env.PUBLIC_API_URL?.trim();
  if (explicit) {
    const cleaned = explicit.replace(/\/$/, "");
    if (!isUnsafeBrowserApiUrl(cleaned)) return cleaned;
  }
  return "/backend";
}

/** Server-side API origin: in-cluster hostname first, then the public URL. */
export function serverApiUrlFromEnv(): string {
  return (
    process.env.INTERNAL_API_URL ||
    process.env.PUBLIC_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:8000"
  ).replace(/\/$/, "");
}

export function publicConfigFromEnv(): PublicConfig {
  return {
    apiUrl: browserApiUrlFromEnv(),
    demoLogin: process.env.DEMO_LOGIN_ENABLED === "1",
    googleLogin: Boolean(process.env.AUTH_GOOGLE_ID),
  };
}

export function parsePublicConfig(data: unknown): PublicConfig | null {
  if (!data || typeof data !== "object") return null;
  const rec = data as Record<string, unknown>;
  if (typeof rec.apiUrl !== "string" || !rec.apiUrl.trim()) return null;
  const apiUrl = rec.apiUrl.trim().replace(/\/$/, "") || "/backend";
  if (isUnsafeBrowserApiUrl(apiUrl)) {
    return {
      apiUrl: "/backend",
      demoLogin: Boolean(rec.demoLogin),
      googleLogin: Boolean(rec.googleLogin),
    };
  }
  return {
    apiUrl,
    demoLogin: Boolean(rec.demoLogin),
    googleLogin: Boolean(rec.googleLogin),
  };
}

/** Turn `/backend` into an absolute URL for copy-paste curl examples. */
export function absoluteApiUrl(apiUrl: string): string {
  if (apiUrl.startsWith("http://") || apiUrl.startsWith("https://")) {
    return apiUrl.replace(/\/$/, "");
  }
  if (typeof window === "undefined") return apiUrl;
  const path = apiUrl.startsWith("/") ? apiUrl : `/${apiUrl}`;
  return `${window.location.origin}${path}`.replace(/\/$/, "");
}

let cached: PublicConfig | null = null;
let inFlight: Promise<PublicConfig> | null = null;

export async function loadPublicConfig(): Promise<PublicConfig> {
  if (typeof window === "undefined") {
    return publicConfigFromEnv();
  }
  if (cached) return cached;
  if (inFlight) return inFlight;
  inFlight = fetch("/api/public-config", { cache: "no-store" })
    .then(async (res) => {
      if (!res.ok) return publicConfigFromEnv();
      const parsed = parsePublicConfig(await res.json());
      const data = parsed ?? publicConfigFromEnv();
      cached = data;
      window.__AGENTFLEET_API_URL__ = data.apiUrl;
      return data;
    })
    .catch(() => publicConfigFromEnv())
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}
