#!/usr/bin/env bash
# Install a complete skilled release bundle, including its pinned Node runtime.
set -euo pipefail
requested_version="${SKILLED_VERSION:-latest}"
install_dir="${INSTALL_DIR:-$HOME/.local/bin}"
repository="${SKILLED_REPOSITORY:-}"
release_base="${SKILLED_RELEASE_BASE_URL:-}"
use_gh="${SKILLED_USE_GH:-0}"
need_cmd() { command -v "$1" >/dev/null 2>&1 || { printf 'error: required command not found: %s\n' "$1" >&2; exit 1; }; }
fail() { printf 'error: %s\n' "$*" >&2; exit 1; }
case "$use_gh" in 0|1) ;; *) fail 'SKILLED_USE_GH must be 0 or 1';; esac
if [ "$use_gh" = 1 ]; then
  [ -z "$release_base" ] && [ -z "${SKILLED_LATEST_VERSION_URL:-}" ] || fail 'SKILLED_USE_GH cannot be combined with a custom release or latest-version URL'
  need_cmd gh
else
  need_cmd curl
fi
need_cmd awk
need_cmd tar
case "$(uname -s)" in Linux) target_os=linux;; Darwin) target_os=darwin;; MINGW*|MSYS*|CYGWIN*) target_os=win32;; *) fail "unsupported OS: $(uname -s)";; esac
case "$(uname -m)" in x86_64|amd64) target_arch=x64;; arm64|aarch64) target_arch=arm64;; *) fail "unsupported architecture: $(uname -m)";; esac
if [ -z "$release_base" ]; then
  repository="${repository:-DeadHead04/skillEd}"
  [[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || fail 'invalid SKILLED_REPOSITORY'
  release_base="https://github.com/$repository/releases/download"
fi
case "$release_base" in https://*|http://*) ;; *) fail 'release base URL must use HTTP or HTTPS';; esac
if [ "$requested_version" = latest ]; then
  if [ "$use_gh" = 1 ]; then
    requested_version="$(gh release view --repo "$repository" --json tagName --jq .tagName)"
  elif [ -n "${SKILLED_LATEST_VERSION_URL:-}" ]; then
    requested_version="$(curl -fsSL --retry 3 "$SKILLED_LATEST_VERSION_URL")"
  elif [ -n "$repository" ]; then
    latest_url="$(curl -fsSLI --retry 3 -o /dev/null -w '%{url_effective}' "https://github.com/$repository/releases/latest")"
    requested_version="${latest_url##*/}"
  else
    requested_version="$(curl -fsSL --retry 3 "${release_base%/}/latest-version.txt")"
  fi
fi
version="${requested_version#v}"
[[ "$version" =~ ^[0-9][A-Za-z0-9.+_-]*$ ]] || fail 'invalid or unresolved release version'
tag="v$version"
bundle="skilled_${version}_${target_os}-${target_arch}"
ext=tar.gz
if [ "$target_os" = win32 ]; then ext=zip; need_cmd unzip; fi
archive="$bundle.$ext"
base_url="${release_base%/}/$tag"
tmp_dir="$(mktemp -d)"
staged_install=''
trap 'rm -rf "$tmp_dir"; if [ -n "$staged_install" ]; then rm -rf "$staged_install"; fi' EXIT
if [ "$use_gh" = 1 ]; then
  printf 'Downloading %s from %s release %s with GitHub CLI\n' "$archive" "$repository" "$tag"
  gh release download "$tag" --repo "$repository" --pattern "$archive" --pattern "$archive.sha256" --dir "$tmp_dir"
  mv "$tmp_dir/$archive.sha256" "$tmp_dir/checksums.txt"
else
  printf 'Downloading %s\n' "$base_url/$archive"
  curl -fL --retry 3 "$base_url/$archive" -o "$tmp_dir/$archive"
  curl -fL --retry 3 "$base_url/$archive.sha256" -o "$tmp_dir/checksums.txt"
fi
expected="$(awk -v wanted="$archive" '$2 == wanted || $2 == "*" wanted {print $1}' "$tmp_dir/checksums.txt")"
[[ "$expected" =~ ^[a-fA-F0-9]{64}$ ]] || fail "missing or ambiguous checksum for $archive"
if command -v sha256sum >/dev/null 2>&1; then actual="$(sha256sum "$tmp_dir/$archive" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then actual="$(shasum -a 256 "$tmp_dir/$archive" | awk '{print $1}')"
else fail 'sha256sum or shasum is required for checksum verification'; fi
[ "$(printf %s "$actual" | tr A-F a-f)" = "$(printf %s "$expected" | tr A-F a-f)" ] || fail 'archive checksum mismatch'
# Validate all paths before extracting the release archive.
if [ "$ext" = zip ]; then unzip -Z1 "$tmp_dir/$archive" > "$tmp_dir/entries"; else tar -tzf "$tmp_dir/$archive" > "$tmp_dir/entries"; fi
while IFS= read -r entry; do
  case "$entry" in "$bundle"|"$bundle/"*) ;; *) fail "unexpected archive entry: $entry";; esac
  case "/$entry/" in */../*|*/./../*) fail "unsafe archive entry: $entry";; esac
done < "$tmp_dir/entries"
if [ "$ext" = zip ]; then unzip -q "$tmp_dir/$archive" -d "$tmp_dir"; else tar -xzf "$tmp_dir/$archive" -C "$tmp_dir"; fi
[ -f "$tmp_dir/$bundle/installation.json" ] && [ -f "$tmp_dir/$bundle/skilled" ] || fail 'archive is not a skilled installation bundle'
[ -f "$tmp_dir/$bundle/app/dist/src/bootstrap.js" ] || fail 'archive is missing the CLI'
mkdir -p "$install_dir/.skilled"
install_dir="$(cd "$install_dir" && pwd)"
# Stage on the destination filesystem; replace the launch wrapper only after validation.
staged_install="$(mktemp -d "$install_dir/.skilled/.install-XXXXXXXX")"
cp -R "$tmp_dir/$bundle/." "$staged_install/"
chmod 0755 "$staged_install/skilled"
runtime_node="$staged_install/runtime/bin/node"
if [ "$target_os" = win32 ]; then runtime_node="$staged_install/runtime/node.exe"; fi
"$runtime_node" -e 'const fs=require("node:fs"); const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(m.product!=="skilled"||m.version!==process.argv[2]||m.target!==process.argv[3]){console.error("error: installation metadata does not match requested product, version or platform");process.exit(1)}' "$staged_install/installation.json" "$version" "$target_os-$target_arch"
installed_version="$("$staged_install/skilled" --version)" || fail 'installed CLI failed its version check'
[ "$installed_version" = "skilled version $version" ] || fail "installed CLI version mismatch: $installed_version"
printf '%s\n' "$installed_version"
# Content-address the directory so reinstall never removes an active bundle.
final_name="$bundle-${actual:0:12}"
if [ -e "$install_dir/.skilled/$final_name" ]; then rm -rf "$staged_install"; else mv "$staged_install" "$install_dir/.skilled/$final_name"; fi
staged_install=''
wrapper="$(mktemp "$install_dir/.skilled-launcher-XXXXXXXX")"
printf '%s\n' '#!/bin/sh' 'SKILLED_BIN_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1' "exec \"\$SKILLED_BIN_DIR/.skilled/$final_name/skilled\" \"\$@\"" > "$wrapper"
chmod 0755 "$wrapper"
mv -f "$wrapper" "$install_dir/skilled"
if [ "$target_os" = win32 ]; then
  printf '@echo off\r\ncall "%%~dp0.skilled\\%s\\skilled.cmd" %%*\r\nexit /b %%errorlevel%%\r\n' "$final_name" > "$install_dir/skilled.cmd"
fi
printf 'Installed skilled to %s/skilled\n' "$install_dir"
case ":$PATH:" in *":$install_dir:"*) ;; *) printf '\nAdd this directory to PATH:\n  export PATH="$PATH:%s"\n' "$install_dir";; esac
