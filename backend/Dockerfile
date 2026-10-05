FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --workspace @squad/backend --include-workspace-root --no-audit --no-fund
COPY backend/tsconfig*.json backend/
COPY backend/src backend/src
RUN npm run build --workspace @squad/backend

FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS runtime
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY backend/prune-runtime.cjs backend/prune-runtime.cjs
RUN npm ci --omit=dev --omit=peer --omit=optional --workspace @squad/backend --include-workspace-root --no-audit --no-fund \
    && node backend/prune-runtime.cjs \
    && npm cache clean --force \
    && mkdir -p /var/lib/squad/jwt \
    && chown node:node /var/lib/squad/jwt
COPY --from=build /app/backend/dist backend/dist
COPY backend/docker-entrypoint.cjs backend/docker-entrypoint.cjs
# Compiled seed-source resolves this same canonical path from backend/dist/database.
COPY frontend/src/data/characters.json frontend/src/data/characters.json
WORKDIR /app/backend
USER node
EXPOSE 3001
ENTRYPOINT ["node", "docker-entrypoint.cjs"]
