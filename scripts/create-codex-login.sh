#!/bin/sh
# Login directly in the configured Docker installation; never copy credentials.
set -eu
echo "Before device login: enable Codex device-code authorization in ChatGPT Settings > Security."
echo "For a managed workspace, an administrator may need to enable it in workspace permissions."
echo "If the browser rejects device authorization, enable that setting and rerun this command for a fresh code."
docker compose run --rm --no-deps worker codex login --device-auth
docker compose run --rm --no-deps -T worker codex login status
