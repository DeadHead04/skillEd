# Installs the complete Windows bundle and verifies its published SHA-256.
[CmdletBinding()]
param(
    [string]$Version = $(if ($env:SKILLED_VERSION) { $env:SKILLED_VERSION } else { 'latest' }),
    [string]$InstallDir = $(if ($env:INSTALL_DIR) { $env:INSTALL_DIR } else { Join-Path $HOME '.local\bin' }),
    [string]$Repository = $env:SKILLED_REPOSITORY,
    [string]$ReleaseBaseUrl = $env:SKILLED_RELEASE_BASE_URL,
    [switch]$UseGh = ($env:SKILLED_USE_GH -eq '1')
)
$ErrorActionPreference = 'Stop'
if ($env:SKILLED_USE_GH -and $env:SKILLED_USE_GH -notin @('0', '1')) { throw 'SKILLED_USE_GH must be 0 or 1.' }
if ($UseGh) {
    if ($ReleaseBaseUrl -or $env:SKILLED_LATEST_VERSION_URL) { throw 'SKILLED_USE_GH cannot be combined with a custom release or latest-version URL.' }
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'GitHub CLI (gh) is required. Install it and run gh auth login first.' }
}
if (-not $ReleaseBaseUrl) {
    if (-not $Repository) { $Repository = 'DeadHead04/skillEd' }
    if ($Repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw 'Invalid SKILLED_REPOSITORY; use owner/repository.' }
    $ReleaseBaseUrl = "https://github.com/$Repository/releases/download"
}
if ($ReleaseBaseUrl -notmatch '^https?://') { throw 'Release base URL must use HTTP or HTTPS.' }
if ($Version -eq 'latest') {
    if ($UseGh) {
        $Version = & gh release view --repo $Repository --json tagName --jq .tagName
        if ($LASTEXITCODE -ne 0) { throw 'GitHub release lookup failed. Check gh authentication and repository access.' }
        $Version = ($Version -join "`n").Trim()
    }
    elseif ($env:SKILLED_LATEST_VERSION_URL) { $Version = (Invoke-WebRequest -UseBasicParsing $env:SKILLED_LATEST_VERSION_URL).Content.Trim() }
    elseif ($Repository) { $Version = (Invoke-RestMethod "https://api.github.com/repos/$Repository/releases/latest").tag_name }
    else { $Version = (Invoke-WebRequest -UseBasicParsing "$($ReleaseBaseUrl.TrimEnd('/'))/latest-version.txt").Content.Trim() }
}
$Version = $Version -replace '^v', ''
if ($Version -notmatch '^[0-9][A-Za-z0-9.+_-]*$') { throw 'Invalid release version.' }
$nativeArch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
$arch = switch ($nativeArch) { 'AMD64' { 'x64' }; 'ARM64' { 'arm64' }; default { throw "Unsupported architecture: $nativeArch" } }
$bundle = "skilled_${Version}_win32-${arch}"
$archive = "$bundle.zip"
$baseUrl = "$($ReleaseBaseUrl.TrimEnd('/'))/v$Version"
$tempDir = Join-Path ([IO.Path]::GetTempPath()) ('skilled-install-' + [Guid]::NewGuid())
$stage = $null
New-Item -ItemType Directory -Path $tempDir | Out-Null
try {
    $download = Join-Path $tempDir $archive
    if ($UseGh) {
        Write-Output "Downloading $archive from $Repository release v$Version with GitHub CLI"
        & gh release download "v$Version" --repo $Repository --pattern $archive --pattern "$archive.sha256" --dir $tempDir
        if ($LASTEXITCODE -ne 0) { throw 'GitHub release download failed. Check gh authentication, repository access and release assets.' }
        $lines = (Get-Content -Raw -LiteralPath (Join-Path $tempDir "$archive.sha256")) -split "`n"
    } else {
        Invoke-WebRequest -UseBasicParsing "$baseUrl/$archive" -OutFile $download
        $lines = (Invoke-WebRequest -UseBasicParsing "$baseUrl/$archive.sha256").Content -split "`n"
    }
    $matchesForFile = @($lines | Where-Object { $_ -match ('^[0-9a-fA-F]{64}\s+\*?' + [regex]::Escape($archive) + '\s*$') })
    if ($matchesForFile.Count -ne 1) { throw 'Missing or ambiguous archive checksum.' }
    $expected = ($matchesForFile[0] -split '\s+')[0]
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $download).Hash
    if ($actual -ne $expected) { throw 'Archive checksum mismatch.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($download)
    try {
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName.Replace('\', '/')
            if (-not $name.StartsWith("$bundle/", [StringComparison]::Ordinal) -or ($name -split '/') -contains '..') { throw "Unsafe archive entry: $name" }
        }
    } finally { $zip.Dispose() }
    Expand-Archive -LiteralPath $download -DestinationPath $tempDir
    $source = Join-Path $tempDir $bundle
    if (-not (Test-Path (Join-Path $source 'installation.json')) -or -not (Test-Path (Join-Path $source 'skilled.cmd'))) { throw 'Archive is not a skilled installation bundle.' }
    New-Item -ItemType Directory -Force -Path (Join-Path $InstallDir '.skilled') | Out-Null
    $InstallDir = (Resolve-Path -LiteralPath $InstallDir).Path
    $stage = Join-Path $InstallDir ('.skilled\.install-' + [Guid]::NewGuid())
    Copy-Item -LiteralPath $source -Destination $stage -Recurse
    $metadata = Get-Content -Raw -LiteralPath (Join-Path $stage 'installation.json') | ConvertFrom-Json
    if ($metadata.product -ne 'skilled' -or $metadata.version -ne $Version -or $metadata.target -ne "win32-$arch") { throw 'Installation metadata does not match requested product, version or platform.' }
    $installedVersion = & (Join-Path $stage 'skilled.cmd') --version
    if ($LASTEXITCODE -ne 0) { throw 'Installed CLI failed its version check.' }
    if (($installedVersion -join "`n") -cne "skilled version $Version") { throw "Installed CLI version mismatch: $installedVersion" }
    Write-Output $installedVersion
    $finalName = "$bundle-$($actual.Substring(0,12).ToLowerInvariant())"
    $final = Join-Path $InstallDir ('.skilled\' + $finalName)
    if (Test-Path $final) { Remove-Item -LiteralPath $stage -Recurse -Force } else { Move-Item -LiteralPath $stage -Destination $final }
    $stage = $null
    $wrapper = Join-Path $InstallDir ('.skilled-launcher-' + [Guid]::NewGuid() + '.cmd')
    $content = "@echo off`r`ncall `"%~dp0.skilled\$finalName\skilled.cmd`" %*`r`nexit /b %errorlevel%`r`n"
    [IO.File]::WriteAllText($wrapper, $content, [Text.Encoding]::ASCII)
    Move-Item -LiteralPath $wrapper -Destination (Join-Path $InstallDir 'skilled.cmd') -Force
    Write-Output "Installed skilled to $InstallDir\skilled.cmd"
    Write-Output "Add $InstallDir to your PATH if it is not already present."
} finally {
    if ($stage -and (Test-Path $stage)) { Remove-Item -LiteralPath $stage -Recurse -Force }
    Remove-Item -LiteralPath $tempDir -Recurse -Force
}
