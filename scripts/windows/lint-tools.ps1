$ErrorActionPreference = 'Stop'
# The lockfile pins the TypeScript compiler and build-time tools.
npm ci
exit $LASTEXITCODE
