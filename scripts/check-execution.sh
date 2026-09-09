#!/bin/sh
set -eu
case "${1:-}" in
  ""|--demo) ;;
  *) echo "Usage: ./scripts/check-execution.sh [--demo]" >&2; exit 2 ;;
esac
# Uses the caller's COMPOSE_FILE and COMPOSE_PROJECT_NAME; no config or secrets
# are printed. It performs no generation, no canary and no credential copying.
docker compose exec -T worker node --import tsx apps/worker/src/readiness-cli.ts "$@"
