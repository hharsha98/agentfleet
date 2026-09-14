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
 * Never put INTERNAL_API_URL here — that can be a docker hostname.
 */
export function browserApiUrlFromEnv(): string {
  const explicit = process.env.PUBLIC_API_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
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
      const data = (await res.json()) as PublicConfig;
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
