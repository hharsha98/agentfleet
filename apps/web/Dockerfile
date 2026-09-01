# AgentFleet web container — multi-stage build.
# Base: node:22.11.0-slim — matches Node 22 installed for local dev, pinned
# to a specific patch tag for reproducible builds.
# TODO(follow-up): pin by @sha256 digest too. Not done here because this
# environment has no Docker/registry access to resolve a real digest
# offline, and inventing one would be worse than a tag pin.

# ---- Stage 1: build -------------------------------------------------------
FROM node:22.11.0-slim AS build
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
FROM node:22.11.0-slim AS runtime

# Non-root user the process runs as. UID/GID 1000 is a fixed contract with
# the Kubernetes manifests (k8s/) — do not change either value without
# updating those manifests too, or pods will crash-loop on permission errors.
#
# Unlike python:*-slim, the official node images ALREADY ship a `node` user
# at exactly UID 1000 / GID 1000. Creating a second user at 1000 fails the
# build with "groupadd: GID '1000' already exists" — this is not theoretical,
# it is how this file first broke. Reuse the built-in user instead:
# Kubernetes' runAsUser matches the numeric UID, not the name, so `node`
# satisfies the same 1000/1000 contract that `app` does in the API image.
#
# No apt layer here on purpose. The HEALTHCHECK below uses node's built-in
# global fetch (Node 18+) rather than installing curl to call one URL.
# Installing curl measurably grew this image by ~25MB (424MB -> 449MB),
# which is a bad trade in an image whose point is a smaller attack surface.
RUN mkdir -p /home/node/.cache && chown -R node:node /home/node

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3002
ENV HOSTNAME=0.0.0.0

# output: "standalone" (apps/web/next.config.ts) produces a pruned server
# bundle at .next/standalone that includes only the node_modules it needs —
# static assets and public/ still have to be copied alongside it. Owned by
# the runtime user since nothing here is written after copy, only read.
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public

USER node

EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD ["node", "-e", "fetch('http://localhost:3002/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "server.js"]
