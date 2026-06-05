#!/bin/sh
set -eu

if [ "${RUN_DB_MIGRATIONS:-false}" = "true" ]; then
  if [ -z "${DATABASE_URL:-}" ]; then
    echo "DATABASE_URL is required when RUN_DB_MIGRATIONS=true."
    exit 1
  fi

  echo "Running Prisma migrations..."
  ./node_modules/.bin/prisma migrate deploy
fi

exec "$@"
