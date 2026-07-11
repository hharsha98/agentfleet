# AgentFleet web container — multi-stage build.
# Base: node:22-slim — matches Node 22 installed for local dev.

# ---- Stage 1: build -------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Baked into the client bundle at build time (Next.js public env var
# convention: NEXT_PUBLIC_* is inlined during `next build`). Override with
# --build-arg for non-default API locations.
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

RUN npm run build

# ---- Stage 2: runtime -------------------------------------------------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3002
ENV HOSTNAME=0.0.0.0

# output: "standalone" (apps/web/next.config.ts) produces a pruned server
# bundle at .next/standalone that includes only the node_modules it needs —
# static assets and public/ still have to be copied alongside it.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

EXPOSE 3002

CMD ["node", "server.js"]
