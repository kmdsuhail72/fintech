#!/bin/sh
set -eu
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  node /workspace/scripts/migrate.mjs
fi
exec "$@"
