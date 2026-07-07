#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-9223}"
PROFILE_DIR="${2:-$PWD/.browser-profile/edge-douyin-gallery}"
EDGE_APP="/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"

mkdir -p "$PROFILE_DIR"

exec "$EDGE_APP" \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PROFILE_DIR" \
  --no-first-run \
  --disable-default-apps \
  "https://www.douyin.com/"
