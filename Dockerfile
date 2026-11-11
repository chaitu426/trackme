# syntax=docker/dockerfile:1.7
# Single image for the whole monorepo. Each Coolify/compose service picks its process
# with a `command:` override (see docker-compose.coolify.yml).

# ---- Go binaries -----------------------------------------------------------
FROM golang:1.22-alpine AS gobuild
WORKDIR /src
COPY services/ingestion-go/go.mod services/ingestion-go/go.sum ./services/ingestion-go/
COPY services/ingest-proxy/go.mod services/ingest-proxy/go.sum ./services/ingest-proxy/
RUN cd services/ingestion-go && go mod download && cd ../ingest-proxy && go mod download
COPY services/ingestion-go ./services/ingestion-go
COPY services/ingest-proxy ./services/ingest-proxy
RUN cd services/ingestion-go && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o bin/ingestion-go ./cmd/server
RUN cd services/ingest-proxy && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o ingest-proxy .

# ---- Node build ------------------------------------------------------------
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat bash
RUN corepack enable && corepack prepare pnpm@10.5.2 --activate
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 CI=true

# Install deps first for layer caching
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY apps/tracker-docs/package.json apps/tracker-docs/
COPY services/ingestion-go/package.json services/ingestion-go/
COPY services/event-worker/package.json services/event-worker/
COPY services/scheduled-worker/package.json services/scheduled-worker/
COPY services/ask-worker/package.json services/ask-worker/
COPY packages ./packages_manifests_tmp
RUN for f in $(cd packages_manifests_tmp && ls); do \
      mkdir -p packages/$f && cp packages_manifests_tmp/$f/package.json packages/$f/ 2>/dev/null || true; \
    done && rm -rf packages_manifests_tmp
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
# Go binaries come from the gobuild stage; `build:app` would otherwise need a Go toolchain here.
# Build only the TS/Next targets.
RUN pnpm exec turbo run build \
      --filter=@trackme/web --filter=@trackme/tracker-docs \
      --filter=@trackme/event-worker --filter=@trackme/scheduled-worker \
      --filter=@trackme/ask-worker --filter=@trackme/db \
      --env-mode=loose

COPY --from=gobuild /src/services/ingestion-go/bin/ingestion-go services/ingestion-go/bin/ingestion-go
COPY --from=gobuild /src/services/ingest-proxy/ingest-proxy services/ingest-proxy/ingest-proxy

# ---- Runtime ---------------------------------------------------------------
FROM node:22-alpine AS runtime
RUN apk add --no-cache libc6-compat tini wget \
 && corepack enable && corepack prepare pnpm@10.5.2 --activate
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app /app
USER node
ENTRYPOINT ["/sbin/tini", "--"]
# Default = dashboard; every other service overrides `command`.
CMD ["pnpm", "--filter", "@trackme/web", "start"]
