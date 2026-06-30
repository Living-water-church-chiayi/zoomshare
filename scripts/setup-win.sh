#!/usr/bin/env bash
# 在 Windows（Git Bash）準備 yt-dlp / deno / ffmpeg，放進 resources/bin/win/
# 用法：在專案根目錄執行  bash scripts/setup-win.sh
set -e
cd "$(dirname "$0")/.."
DEST="resources/bin/win"
mkdir -p "$DEST"

echo "下載 yt-dlp.exe ..."
curl -L --fail -o "$DEST/yt-dlp.exe" "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"

echo "下載 deno.exe ..."
curl -L --fail -o /tmp/deno-win.zip "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip"
unzip -o /tmp/deno-win.zip -d "$DEST" >/dev/null
rm -f /tmp/deno-win.zip

echo "下載 ffmpeg / ffprobe ..."
curl -L --fail -o /tmp/ffmpeg-win.zip "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip"
unzip -o -j /tmp/ffmpeg-win.zip "*/bin/ffmpeg.exe" "*/bin/ffprobe.exe" -d "$DEST" >/dev/null
rm -f /tmp/ffmpeg-win.zip

echo ""
echo "完成 ✅  resources/bin/win 內容："
ls -la "$DEST"
echo ""
echo "接著執行：npm install && npm run build:win"
