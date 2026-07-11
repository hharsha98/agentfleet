import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a minimal .next/standalone server bundle (node_modules pruned to
  // only what's needed at runtime) — required for the multi-stage Docker
  // build in apps/web/Dockerfile to keep the runtime image small.
  output: "standalone",
};

export default nextConfig;
