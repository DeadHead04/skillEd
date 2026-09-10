#!/bin/sh
set -eu

mode="real"
if [ "${1:-}" = "--demo" ]; then
  mode="demo"
elif [ -n "${1:-}" ]; then
  echo "Usage: ./scripts/preflight.sh [--demo]" >&2
  exit 2
fi

for command_name in git docker curl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
done

docker compose version >/dev/null
docker info >/dev/null
docker compose config --quiet

if [ ! -f .env ]; then
  echo "Warning: .env is absent; trusted-local development defaults will apply."
fi

echo "SkillEd preflight passed ($mode mode)."
if [ "$mode" = "real" ]; then
  echo "This checks local prerequisites only; it does not certify execution."
  echo "Login is stored inside Docker. Run ./scripts/setup-docker-execution.sh --real to initialize execution."
  echo "Before generation, run ./scripts/check-execution.sh against the running worker."
fi
