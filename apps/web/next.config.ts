import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker (apps/web/Dockerfile) needs a standalone server bundle. OpenNext
  // on Cloudflare adapts `next build` itself and rejects `output: "standalone"`.
  // Vercel and `npm run build` keep the Docker default; `npm run cf:build`
  // sets OPEN_NEXT=1.
  ...(process.env.OPEN_NEXT === "1" ? {} : { output: "standalone" as const }),
};

export default nextConfig;
