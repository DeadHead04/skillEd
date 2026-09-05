#!/bin/sh
set -eu

mode="real"
if [ "${1:-}" = "--demo" ]; then
  mode="demo"
elif [ -n "${1:-}" ]; then
  echo "Usage: ./scripts/verify-stack.sh [--demo]" >&2
  exit 2
fi

attempt=1
health=""
while [ "$attempt" -le 30 ]; do
  if health=$(curl -fsS "${SKILLED_BASE_URL:-http://127.0.0.1:3000}/api/v1/health" 2>/dev/null); then
    if printf '%s' "$health" | grep -q '"status":"ready"'; then
      break
    fi
  fi
  attempt=$((attempt + 1))
  sleep 2
done

if ! printf '%s' "$health" | grep -q '"status":"ready"'; then
  echo "SkillEd did not become ready." >&2
  docker compose ps >&2
  docker compose logs --tail=100 worker >&2
  exit 1
fi

printf '%s\n' "$health"

if [ "$mode" = "demo" ]; then
  printf '%s' "$health" | grep -q '"codexLogin":"fake-ready"' || {
    echo "Stack is healthy but the worker is not in demo mode." >&2
    exit 1
  }
else
  printf '%s' "$health" | grep -q '"execution":"ready"' || {
    echo "Web and history are available, but the required execution acceptance gate has not passed." >&2
    exit 1
  }
fi

docker compose ps
echo "SkillEd stack verification passed ($mode mode)."
