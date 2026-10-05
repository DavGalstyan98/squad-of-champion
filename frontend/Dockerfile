FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci --workspace @squad/frontend --include-workspace-root --no-audit --no-fund
COPY frontend/tsconfig.json frontend/tsconfig.json
COPY frontend/src frontend/src
COPY frontend/public frontend/public
# Same-origin API routing works on localhost, alternate ports, and another browser host.
ARG REACT_APP_API_URL=/api/v1
ENV REACT_APP_API_URL=$REACT_APP_API_URL
ENV GENERATE_SOURCEMAP=false
RUN npm run build --workspace @squad/frontend

FROM nginx:1.28-alpine@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/build /usr/share/nginx/html
EXPOSE 80
# The official image uses SIGQUIT for graceful shutdown.
