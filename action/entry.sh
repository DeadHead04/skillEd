#!/usr/bin/env bash
# Docker container action entrypoint.
#
# The image bakes Node.js and the compiled TypeScript action.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for p in /usr/local/bin /usr/bin "$HOME/.local/bin"; do
  case ":$PATH:" in
    *":$p:"*) ;;
    *) [ -d "$p" ] && PATH="$p:$PATH" ;;
  esac
done
export PATH

set -euo pipefail

restore_workspace_permissions() {
  local workspace="${GITHUB_WORKSPACE:-}"
  [ -n "$workspace" ] || return 0

  local report_dir="$workspace/skilled-workspace"
  [ -e "$report_dir" ] || return 0

  # Docker actions run as root and write into the host-mounted workspace.
  # Hand generated reports back to the runner user so the next checkout can
  # clean the workspace on self-hosted runners.
  local owner
  if ! owner="$(stat -c '%u:%g' "$workspace")"; then
    echo "[entry] failed to determine workspace ownership" >&2
    return 1
  fi
  if ! chown -R "$owner" "$report_dir"; then
    echo "[entry] failed to restore report ownership" >&2
    return 1
  fi
  if ! chmod -R u+rwX,go+rX "$report_dir"; then
    echo "[entry] failed to restore report permissions" >&2
    return 1
  fi
}

cleanup() {
  local status=$?
  if ! restore_workspace_permissions && [ "$status" -eq 0 ]; then
    status=1
  fi
  exit "$status"
}
trap cleanup EXIT

if ! command -v node >/dev/null 2>&1; then
  echo "[entry] no Node.js runtime found" >&2
  exit 1
fi
node "${SKILLED_ACTION_MAIN:-$DIR/../dist/action/main.js}" "$@"
