#!/bin/sh
set -eu

if ! command -v codex >/dev/null 2>&1; then
  echo "Codex CLI is required to create a new browser login." >&2
  exit 1
fi

repository_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
dedicated_home="$repository_root/.auth/codex"
mkdir -p "$dedicated_home"
chmod 700 "$dedicated_home"

config_file="$dedicated_home/config.toml"
if [ ! -f "$config_file" ]; then
  umask 077
  printf '%s\n' 'cli_auth_credentials_store = "file"' >"$config_file"
fi

CODEX_HOME="$dedicated_home" codex login
CODEX_HOME="$dedicated_home" codex login status

auth_file="$dedicated_home/auth.json"
if [ ! -f "$auth_file" ]; then
  echo "Login completed but auth.json was not created at $auth_file" >&2
  exit 1
fi
chmod 600 "$auth_file"

echo "Add this absolute path to .env:"
echo "CODEX_AUTH_FILE=$auth_file"
