#!/bin/sh
set -eu
# Existing named volumes do not receive directories added in newer images.
mkdir -p "${TMPDIR:-/data/work/tmp}"
exec "$@"
