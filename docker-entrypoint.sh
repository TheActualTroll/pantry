#!/bin/sh
# Railway mounts volumes as root. Fix ownership, then drop privileges so the
# app never runs as root.
set -e
DIR="${DATA_DIR:-/data}"
mkdir -p "$DIR"
chown -R node:node "$DIR"
exec setpriv --reuid=node --regid=node --init-groups \
  node --disable-warning=ExperimentalWarning dist/server/index.mjs
