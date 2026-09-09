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

if [ "$mode" = "real" ]; then
  auth_file="${CODEX_AUTH_FILE:-}"
  if [ -z "$auth_file" ] && [ -f .env ]; then
    auth_file=$(sed -n 's/^[[:space:]]*CODEX_AUTH_FILE[[:space:]]*=[[:space:]]*//p' .env | tail -n 1)
    case "$auth_file" in
      \"*\") auth_file=${auth_file#\"}; auth_file=${auth_file%\"} ;;
      \'*\') auth_file=${auth_file#\'}; auth_file=${auth_file%\'} ;;
    esac
  fi
  auth_file="${auth_file:-${HOME}/.codex/auth.json}"
  if [ ! -f "$auth_file" ]; then
    echo "Codex auth file not found: $auth_file" >&2
    echo "Run ./scripts/create-codex-login.sh, then set CODEX_AUTH_FILE in .env." >&2
    exit 1
  fi
  if [ ! -r "$auth_file" ] || [ ! -w "$auth_file" ]; then
    echo "Codex auth file must be readable and writable: $auth_file" >&2
    exit 1
  fi
fi

echo "SkillEd preflight passed ($mode mode)."
if [ "$mode" = "real" ]; then
  echo "This checks local prerequisites only; it does not certify execution."
  echo "Before generation, run ./scripts/check-execution.sh against the running worker."
fi
