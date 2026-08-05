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
FROM golang:1.25-alpine AS server
WORKDIR /build/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /rust-rush .

# --- Stage 3: runtime --------------------------------------------------------
FROM alpine:3.20
WORKDIR /app
COPY --from=server /rust-rush ./rust-rush
COPY --from=client /build/client/dist ./client/dist

ENV PORT=8080 \
    STATIC_DIR=/app/client/dist \
    STATS_DB=/data/stats.db

EXPOSE 8080

# busybox wget ships with alpine — no extra packages needed
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -q -O /dev/null http://localhost:8080/health || exit 1

CMD ["./rust-rush"]
