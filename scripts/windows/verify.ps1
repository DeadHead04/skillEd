$ErrorActionPreference = 'Stop'
npm run verify
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
npm test
exit $LASTEXITCODE
