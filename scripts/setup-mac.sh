#!/usr/bin/env bash
# Prepare reproducible universal macOS helper binaries in resources/bin/mac/.
# Requires macOS 12+ command-line tools (curl, unzip, lipo, codesign, shasum).
set -euo pipefail
IFS=$'\n\t'

readonly YT_DLP_VERSION="2026.07.04"
readonly DENO_VERSION="2.9.0"
readonly FFMPEG_STATIC_VERSION="b6.1.1"

# Digests are pinned to the corresponding GitHub release assets. Updating a
# version requires reviewing upstream release notes and replacing its digest.
readonly YT_DLP_SHA256="498bd0dae17855c599d371d68ec5bafc439a9d8640e838be25c765a9792f261b"
readonly DENO_ARM64_SHA256="2d11cf0505d4600a4492de8d07456a7a5e7eedebf68bdcbcb9092f520fcde0f1"
readonly DENO_X64_SHA256="04f71604d738ef2a3b0c08d00743b1a6580fd65d0dab604da2f57f30f4c74b55"
readonly FFMPEG_ARM64_SHA256="a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584"
readonly FFMPEG_X64_SHA256="ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894"
readonly FFPROBE_ARM64_SHA256="bb2db6f5d8cef919da12fbf592119a987202a8c060a886f3cab091f9cab90b64"
readonly FFPROBE_X64_SHA256="fa3add0ce901f7241abe0dfc0155d958fc834aca3f8ce61f87cc712ae669c1e0"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIR
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
readonly PROJECT_ROOT
readonly DEST="$PROJECT_ROOT/resources/bin/mac"

for required_command in curl unzip lipo shasum codesign xattr install; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "Missing required command: $required_command" >&2
    exit 1
  fi
done

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/zoomshare-mac-bin.XXXXXX")"
readonly TMP_DIR
cleanup() {
  rm -rf -- "$TMP_DIR"
}
trap cleanup EXIT

readonly STAGE="$TMP_DIR/stage"
mkdir -p "$STAGE" "$TMP_DIR/deno-arm64" "$TMP_DIR/deno-x64"

download_verified() {
  local label="$1"
  local url="$2"
  local expected_sha256="$3"
  local destination="$4"
  local actual_sha256

  echo "Downloading $label ..."
  curl --fail --location --silent --show-error \
    --retry 5 --retry-delay 2 --retry-all-errors \
    --connect-timeout 20 --max-time 900 \
    --proto '=https' --tlsv1.2 \
    --output "$destination" "$url"

  actual_sha256="$(shasum -a 256 "$destination" | awk '{print $1}')"
  if [[ "$actual_sha256" != "$expected_sha256" ]]; then
    echo "SHA-256 mismatch for $label" >&2
    echo "Expected: $expected_sha256" >&2
    echo "Actual:   $actual_sha256" >&2
    exit 1
  fi
}

require_arch() {
  local file="$1"
  local expected_arch="$2"
  local archs
  archs="$(lipo -archs "$file")"
  if [[ " $archs " != *" $expected_arch "* ]]; then
    echo "Expected $file to contain $expected_arch; found: $archs" >&2
    exit 1
  fi
}

require_universal() {
  local file="$1"
  require_arch "$file" "arm64"
  require_arch "$file" "x86_64"
}

readonly YT_DLP_DOWNLOAD="$TMP_DIR/yt-dlp_macos"
readonly DENO_ARM64_ZIP="$TMP_DIR/deno-arm64.zip"
readonly DENO_X64_ZIP="$TMP_DIR/deno-x64.zip"
readonly FFMPEG_ARM64_DOWNLOAD="$TMP_DIR/ffmpeg-arm64"
readonly FFMPEG_X64_DOWNLOAD="$TMP_DIR/ffmpeg-x64"
readonly FFPROBE_ARM64_DOWNLOAD="$TMP_DIR/ffprobe-arm64"
readonly FFPROBE_X64_DOWNLOAD="$TMP_DIR/ffprobe-x64"

download_verified \
  "yt-dlp $YT_DLP_VERSION" \
  "https://github.com/yt-dlp/yt-dlp/releases/download/$YT_DLP_VERSION/yt-dlp_macos" \
  "$YT_DLP_SHA256" "$YT_DLP_DOWNLOAD"
download_verified \
  "Deno $DENO_VERSION arm64" \
  "https://github.com/denoland/deno/releases/download/v$DENO_VERSION/deno-aarch64-apple-darwin.zip" \
  "$DENO_ARM64_SHA256" "$DENO_ARM64_ZIP"
download_verified \
  "Deno $DENO_VERSION x86_64" \
  "https://github.com/denoland/deno/releases/download/v$DENO_VERSION/deno-x86_64-apple-darwin.zip" \
  "$DENO_X64_SHA256" "$DENO_X64_ZIP"
download_verified \
  "ffmpeg $FFMPEG_STATIC_VERSION arm64" \
  "https://github.com/eugeneware/ffmpeg-static/releases/download/$FFMPEG_STATIC_VERSION/ffmpeg-darwin-arm64" \
  "$FFMPEG_ARM64_SHA256" "$FFMPEG_ARM64_DOWNLOAD"
download_verified \
  "ffmpeg $FFMPEG_STATIC_VERSION x86_64" \
  "https://github.com/eugeneware/ffmpeg-static/releases/download/$FFMPEG_STATIC_VERSION/ffmpeg-darwin-x64" \
  "$FFMPEG_X64_SHA256" "$FFMPEG_X64_DOWNLOAD"
download_verified \
  "ffprobe $FFMPEG_STATIC_VERSION arm64" \
  "https://github.com/eugeneware/ffmpeg-static/releases/download/$FFMPEG_STATIC_VERSION/ffprobe-darwin-arm64" \
  "$FFPROBE_ARM64_SHA256" "$FFPROBE_ARM64_DOWNLOAD"
download_verified \
  "ffprobe $FFMPEG_STATIC_VERSION x86_64" \
  "https://github.com/eugeneware/ffmpeg-static/releases/download/$FFMPEG_STATIC_VERSION/ffprobe-darwin-x64" \
  "$FFPROBE_X64_SHA256" "$FFPROBE_X64_DOWNLOAD"

unzip -q "$DENO_ARM64_ZIP" -d "$TMP_DIR/deno-arm64"
unzip -q "$DENO_X64_ZIP" -d "$TMP_DIR/deno-x64"

require_arch "$TMP_DIR/deno-arm64/deno" "arm64"
require_arch "$TMP_DIR/deno-x64/deno" "x86_64"
require_arch "$FFMPEG_ARM64_DOWNLOAD" "arm64"
require_arch "$FFMPEG_X64_DOWNLOAD" "x86_64"
require_arch "$FFPROBE_ARM64_DOWNLOAD" "arm64"
require_arch "$FFPROBE_X64_DOWNLOAD" "x86_64"

cp "$YT_DLP_DOWNLOAD" "$STAGE/yt-dlp_macos"
lipo -create "$TMP_DIR/deno-arm64/deno" "$TMP_DIR/deno-x64/deno" -output "$STAGE/deno"
lipo -create "$FFMPEG_ARM64_DOWNLOAD" "$FFMPEG_X64_DOWNLOAD" -output "$STAGE/ffmpeg"
lipo -create "$FFPROBE_ARM64_DOWNLOAD" "$FFPROBE_X64_DOWNLOAD" -output "$STAGE/ffprobe"

xattr -dr com.apple.quarantine "$STAGE" 2>/dev/null || true
for binary_name in yt-dlp_macos deno ffmpeg ffprobe; do
  binary="$STAGE/$binary_name"
  chmod 0755 "$binary"
  require_universal "$binary"
  codesign --force --sign - --timestamp=none "$binary"
  codesign --verify --strict "$binary"
done

if [[ "$("$STAGE/yt-dlp_macos" --version)" != "$YT_DLP_VERSION" ]]; then
  echo "yt-dlp version verification failed" >&2
  exit 1
fi
deno_version_output="$("$STAGE/deno" --version)"
if [[ "$deno_version_output" != *"deno $DENO_VERSION"* ]]; then
  echo "Deno version verification failed" >&2
  exit 1
fi
ffmpeg_version_output="$("$STAGE/ffmpeg" -version 2>&1)"
ffmpeg_version_line="${ffmpeg_version_output%%$'\n'*}"
# The b6.1.1 assets are pinned above by their exact SHA-256 digests, while
# their compiled banners may use an upstream Git revision instead of "6.1.1".
# Executing each merged binary and checking its banner still catches a broken
# or wrong-kind universal binary without relying on that unstable label.
if [[ "$ffmpeg_version_line" != ffmpeg\ version\ * ]]; then
  echo "ffmpeg version verification failed" >&2
  echo "Observed: $ffmpeg_version_line" >&2
  exit 1
fi
ffprobe_version_output="$("$STAGE/ffprobe" -version 2>&1)"
ffprobe_version_line="${ffprobe_version_output%%$'\n'*}"
if [[ "$ffprobe_version_line" != ffprobe\ version\ * ]]; then
  echo "ffprobe version verification failed" >&2
  echo "Observed: $ffprobe_version_line" >&2
  exit 1
fi

mkdir -p "$DEST"
for binary_name in yt-dlp_macos deno ffmpeg ffprobe; do
  install -m 0755 "$STAGE/$binary_name" "$DEST/$binary_name"
  require_universal "$DEST/$binary_name"
  codesign --verify --strict "$DEST/$binary_name"
done
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

echo "Prepared pinned universal macOS helpers in $DEST"
echo "  yt-dlp: $YT_DLP_VERSION"
echo "  deno:   $DENO_VERSION"
echo "  ffmpeg: ${FFMPEG_STATIC_VERSION#b}"
lipo -info "$DEST/yt-dlp_macos"
lipo -info "$DEST/deno"
lipo -info "$DEST/ffmpeg"
lipo -info "$DEST/ffprobe"
