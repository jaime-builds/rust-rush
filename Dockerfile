# Rust Rush — single-image production build.
#
# Multi-stage: build the React client, build the Go server (pure Go — the
# SQLite driver is modernc.org/sqlite, so CGO stays off), then copy both into
# a minimal runtime image. The server serves the client itself via STATIC_DIR
# (Phase 16), so one container = the whole game.
#
# Built locally on the homelab (pull_policy: never pattern, same as
# ytplayer/ledgerview) — no registry push. Example compose service:
#
#   rust-rush:
#     build: .
#     image: rust-rush:latest
#     pull_policy: never
#     ports: ["8080:8080"]
#     volumes:
#       - /mnt/user/appdata/rust-rush:/data
#     cpus: "2"
#     mem_limit: 512m
#     pids_limit: 256
#     environment:
#       - ALLOWED_ORIGINS=https://rust-rush.jaime.build
#       - ADMIN_USERNAME=<from secrets>
#       - ADMIN_PASSWORD=<from secrets>
#
# Env vars:
#   PORT             listen port                      (default 8080)
#   STATIC_DIR       client build dir                 (set to /app/client/dist here)
#   STATS_DB         SQLite stats file                (set to /data/stats.db here)
#   ALLOWED_ORIGINS  comma-separated WS origins       (default: allow all)
#   ADMIN_USERNAME   admin login user                 (no default — unset closes /stats)
#   ADMIN_PASSWORD   admin login password             (no default — unset closes /stats)
#   DEBUG_SPAWN      1 enables the debug enemy spawner (default off; never in production)
#
# ADMIN_* have no fallback on purpose: leaving them unset locks the stats page
# rather than shipping a guessable pair. /health stays public either way.

# --- Stage 1: client ---------------------------------------------------------
FROM node:22-alpine AS client
WORKDIR /build/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# --- Stage 2: server ---------------------------------------------------------
FROM golang:1.27.4-alpine3.24 AS server
WORKDIR /build/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
# -trimpath keeps the build machine's folder paths out of the binary.
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /rust-rush .

# --- Stage 3: runtime --------------------------------------------------------
# Alpine 3.24 is in its support window (3.20 stopped getting fixes in April
# 2026). Pinned to the point release so a rebuild can't silently reuse an
# older cached 3.24 base. The server runs as uid 99 / gid 100, Unraid's usual
# nobody:users, not root. The /data bind mount on the host must be owned by
# 99:100 too, or the stats database can't be written (see README.md, Docker
# note).
FROM alpine:3.24.4
# Point releases lag the package repo: 3.24.4 still ships zlib 1.3.2-r1, and
# the fix (1.4-r0) is only in the v3.24 repo. Upgrade the base packages at
# build time so security fixes land without waiting for the next tag. Docker
# caches this layer, so rebuild with --pull --no-cache to pick up new fixes.
RUN apk upgrade --no-cache
WORKDIR /app
COPY --from=server /rust-rush ./rust-rush
COPY --from=client /build/client/dist ./client/dist
RUN mkdir -p /data && chown 99:100 /data
USER 99:100

ENV PORT=8080 \
    STATIC_DIR=/app/client/dist \
    STATS_DB=/data/stats.db

EXPOSE 8080

# busybox wget ships with alpine — no extra packages needed
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://localhost:8080/health || exit 1

CMD ["./rust-rush"]
