#!/usr/bin/env bash
# 在 Windows（Git Bash）準備固定版本的 yt-dlp / deno / ffmpeg。
# 用法：在專案根目錄執行 bash scripts/setup-win.sh
set -euo pipefail

cd "$(dirname "$0")/.."
DEST="resources/bin/win"
mkdir -p "$DEST"

YT_DLP_VERSION="2026.07.04"
DENO_VERSION="2.9.0"
FFMPEG_RELEASE="b6.1.1"

TMP_ROOT="${TMPDIR:-/tmp}"
TMP_DIR="$(mktemp -d "$TMP_ROOT/zoomshare-win.XXXXXX")"
cleanup() {
  case "$TMP_DIR" in
    "$TMP_ROOT"/zoomshare-win.*) rm -rf -- "$TMP_DIR" ;;
  esac
}
trap cleanup EXIT

download() {
  local url="$1"
  local output="$2"
  curl --fail --location --silent --show-error \
    --retry 4 --retry-delay 2 --connect-timeout 20 --max-time 600 \
    --output "$output" "$url"
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

verify_sha256() {
  local file="$1"
  local expected="$2"
  local actual
  actual="$(sha256_file "$file")"
  if [[ "$actual" != "$expected" ]]; then
    echo "SHA-256 驗證失敗：$file" >&2
    echo "預期：$expected" >&2
    echo "實際：$actual" >&2
    exit 1
  fi
}

echo "下載 yt-dlp $YT_DLP_VERSION ..."
download \
  "https://github.com/yt-dlp/yt-dlp/releases/download/$YT_DLP_VERSION/yt-dlp.exe" \
  "$TMP_DIR/yt-dlp.exe"
verify_sha256 "$TMP_DIR/yt-dlp.exe" "52fe3c26dcf71fbdc85b528589020bb0b8e383155cfa81b64dd447bbe35e24b8"

echo "下載 Deno $DENO_VERSION ..."
download \
  "https://github.com/denoland/deno/releases/download/v$DENO_VERSION/deno-x86_64-pc-windows-msvc.zip" \
  "$TMP_DIR/deno.zip"
verify_sha256 "$TMP_DIR/deno.zip" "37e3a8e5f4ee360d08bbeec9ee07fdcaa9dcd1a39d4aeaac5807354aec557451"
unzip -q -o "$TMP_DIR/deno.zip" -d "$TMP_DIR/deno"

echo "下載 FFmpeg 6.1.1 精簡靜態版 ..."
download \
  "https://github.com/eugeneware/ffmpeg-static/releases/download/$FFMPEG_RELEASE/ffmpeg-win32-x64" \
  "$TMP_DIR/ffmpeg.exe"
download \
  "https://github.com/eugeneware/ffmpeg-static/releases/download/$FFMPEG_RELEASE/ffprobe-win32-x64" \
  "$TMP_DIR/ffprobe.exe"
download \
  "https://github.com/eugeneware/ffmpeg-static/releases/download/$FFMPEG_RELEASE/win32-x64.LICENSE" \
  "$TMP_DIR/FFMPEG-LICENSE.txt"
verify_sha256 "$TMP_DIR/ffmpeg.exe" "04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00"
verify_sha256 "$TMP_DIR/ffprobe.exe" "3a7e2dc003dc2cd1472827e4c7c4f056ae1ae0ae7c5bbc580c99b49827351ba4"
verify_sha256 "$TMP_DIR/FFMPEG-LICENSE.txt" "8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903"

"$TMP_DIR/yt-dlp.exe" --version >/dev/null
"$TMP_DIR/deno/deno.exe" --version >/dev/null
"$TMP_DIR/ffmpeg.exe" -version >/dev/null 2>&1
"$TMP_DIR/ffprobe.exe" -version >/dev/null 2>&1

cp -f "$TMP_DIR/yt-dlp.exe" "$DEST/yt-dlp.exe"
cp -f "$TMP_DIR/deno/deno.exe" "$DEST/deno.exe"
cp -f "$TMP_DIR/ffmpeg.exe" "$DEST/ffmpeg.exe"
cp -f "$TMP_DIR/ffprobe.exe" "$DEST/ffprobe.exe"
cp -f "$TMP_DIR/FFMPEG-LICENSE.txt" "$DEST/FFMPEG-LICENSE.txt"

echo ""
echo "完成：resources/bin/win"
ls -lh "$DEST"
echo ""
echo "接著執行：npm ci && npm run build:win"
