#!/bin/sh
# Measured real acceptance in two different containers with persistent state.
# Uses the caller's existing COMPOSE_FILE / COMPOSE_PROJECT_NAME configuration.
set -eu
if [ "${1:-}" != "--real" ]; then
  echo "Usage: ./scripts/setup-docker-execution.sh --real" >&2
  echo "This performs real Codex acceptance and consumes model requests." >&2
  exit 2
fi
docker compose build worker
# No ordinary jobs may overlap acceptance. The worker preserves durable state.
docker compose stop worker
# Restore history/diagnostics service even if acceptance fails. The worker
# independently enforces the blocked report and cannot silently enable work.
trap 'docker compose up -d worker' EXIT
docker compose run --rm --no-deps -T worker python3 /opt/skilled/isolation-canary.py
if ! docker compose run --rm --no-deps -T worker codex login status; then
  echo "Complete the official Codex login for this Docker installation."
  ./scripts/create-codex-login.sh
fi
docker compose run --rm --no-deps -T worker node --import tsx apps/worker/src/execution-acceptance.ts prepare --real
docker compose run --rm --no-deps -T worker node --import tsx apps/worker/src/execution-acceptance.ts resume --real
docker compose up -d worker
trap - EXIT
./scripts/check-execution.sh
echo "Docker execution acceptance passed. The browser can now launch real work."
