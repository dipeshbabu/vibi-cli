#!/bin/sh
# vibi installer: https://vibivibi.com
#
#   curl -fsSL https://vibivibi.com/install.sh | sh
#
# Downloads the vibi executable for this machine from the GitHub release,
# checks its SHA-256 against the release's checksums.txt, puts it in
# ~/.vibi/bin (no root needed) and makes sure that directory is on PATH.
# `vibi upgrade` runs this again.
#
#   VIBI_VERSION=v0.2.0     install that release instead of the latest one
#   VIBI_INSTALL_DIR=DIR    install somewhere else
#   VIBI_RELEASE_URL=URL    fetch the assets from URL instead of GitHub (mirrors, tests)
set -eu

REPO="${VIBI_REPO:-subconscious-systems/vibi-cli}"
INSTALL_DIR="${VIBI_INSTALL_DIR:-$HOME/.vibi/bin}"

say() { printf '%s\n' "$*"; }
die() { printf 'vibi install: %s\n' "$*" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  MINGW*|MSYS*|CYGWIN*) die "on Windows, run this in PowerShell instead:  irm https://vibivibi.com/install.ps1 | iex" ;;
  *) die "unsupported operating system: $(uname -s)" ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) die "unsupported architecture: $(uname -m)" ;;
esac
if [ "$os" = linux ] && command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -qi musl; then
  die "this build needs glibc; Alpine and other musl systems are not supported yet"
fi

asset="vibi-$os-$arch.tar.gz"
if [ -n "${VIBI_RELEASE_URL:-}" ]; then
  base="${VIBI_RELEASE_URL%/}"
elif [ -n "${VIBI_VERSION:-}" ]; then
  base="https://github.com/$REPO/releases/download/$VIBI_VERSION"
else
  base="https://github.com/$REPO/releases/latest/download"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 3 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O "$2" "$1"
  else
    die "curl or wget is required"
  fi
}

say "Downloading $asset from $base ..."
fetch "$base/$asset" "$tmp/$asset" || die "could not download $base/$asset"
fetch "$base/checksums.txt" "$tmp/checksums.txt" || die "could not download $base/checksums.txt"

expected="$(awk -v f="$asset" '$2 == f { print $1 }' "$tmp/checksums.txt")"
[ -n "$expected" ] || die "$asset is not listed in checksums.txt"
if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$tmp/$asset" | awk '{ print $1 }')"
elif command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "$tmp/$asset" | awk '{ print $1 }')"
else
  die "sha256sum or shasum is required"
fi
[ "$actual" = "$expected" ] || die "checksum mismatch for $asset (expected $expected, got $actual)"

tar -xzf "$tmp/$asset" -C "$tmp"
mkdir -p "$INSTALL_DIR"
# Written next to the target and renamed over it, so a vibi that is running
# right now (`vibi upgrade`) keeps its old file until it exits.
mv -f "$tmp/vibi" "$INSTALL_DIR/vibi.new"
chmod 755 "$INSTALL_DIR/vibi.new"
mv -f "$INSTALL_DIR/vibi.new" "$INSTALL_DIR/vibi"
if [ "$os" = darwin ]; then xattr -d com.apple.quarantine "$INSTALL_DIR/vibi" 2>/dev/null || true; fi

case ":$PATH:" in
  *":$INSTALL_DIR:"*) on_path=1 ;;
  *) on_path=0 ;;
esac
if [ "$on_path" = 0 ]; then
  line="export PATH=\"$INSTALL_DIR:\$PATH\""
  case "$(basename "${SHELL:-sh}")" in
    zsh) rc="$HOME/.zshrc" ;;
    bash) if [ "$os" = darwin ]; then rc="$HOME/.bash_profile"; else rc="$HOME/.bashrc"; fi ;;
    fish) rc="$HOME/.config/fish/config.fish"; line="fish_add_path \"$INSTALL_DIR\"" ;;
    *) rc="" ;;
  esac
  if [ -n "$rc" ]; then
    mkdir -p "$(dirname "$rc")"
    if ! grep -qsF "$INSTALL_DIR" "$rc"; then printf '\n# vibi\n%s\n' "$line" >> "$rc"; fi
    say "Added $INSTALL_DIR to PATH in $rc. Open a new terminal, or run:  $line"
  else
    say "Add $INSTALL_DIR to your PATH:  $line"
  fi
fi

say "Installed vibi $("$INSTALL_DIR/vibi" --version) to $INSTALL_DIR/vibi"
say "Next: vibi enroll <code>   (codes come from https://vibivibi.com/dashboard/machines)"
