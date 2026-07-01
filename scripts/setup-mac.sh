#!/usr/bin/env bash
# 在 Mac 上準備 yt-dlp / deno / ffmpeg，放進 resources/bin/mac/
# 用法：在專案根目錄執行  bash scripts/setup-mac.sh
set -e
cd "$(dirname "$0")/.."
DEST="resources/bin/mac"
mkdir -p "$DEST"

ARCH="${MAC_ARCH:-$(uname -m)}"   # 可用 MAC_ARCH 覆寫（arm64 / x86_64）；否則偵測
echo "目標 CPU 架構：$ARCH"

# ---- yt-dlp（抽取串流）----
echo "下載 yt-dlp ..."
curl -L --fail -o "$DEST/yt-dlp_macos" "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"

# ---- deno（解 YouTube JS 挑戰）----
if [ "$ARCH" = "arm64" ]; then
  DENO_URL="https://github.com/denoland/deno/releases/latest/download/deno-aarch64-apple-darwin.zip"
else
  DENO_URL="https://github.com/denoland/deno/releases/latest/download/deno-x86_64-apple-darwin.zip"
fi
echo "下載 deno ..."
curl -L --fail -o /tmp/deno.zip "$DENO_URL"
unzip -o /tmp/deno.zip -d "$DEST" >/dev/null
rm -f /tmp/deno.zip

# ---- ffmpeg / ffprobe（合併、轉檔）----
# evermeet.cx 提供 macOS 靜態檔（Intel；Apple Silicon 透過 Rosetta 執行）
echo "下載 ffmpeg ..."
curl -L --fail -o /tmp/ffmpeg.zip "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip"
unzip -o /tmp/ffmpeg.zip -d "$DEST" >/dev/null
rm -f /tmp/ffmpeg.zip
echo "下載 ffprobe ..."
curl -L --fail -o /tmp/ffprobe.zip "https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip"
unzip -o /tmp/ffprobe.zip -d "$DEST" >/dev/null
rm -f /tmp/ffprobe.zip

# 可執行權限 + 解除 Gatekeeper 隔離
chmod +x "$DEST/yt-dlp_macos" "$DEST/deno" "$DEST/ffmpeg" "$DEST/ffprobe" 2>/dev/null || true
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

echo ""
echo "完成 ✅  resources/bin/mac 內容："
ls -la "$DEST"
echo ""
echo "接著執行：npm install && npm run build:mac"
echo "（若 Apple Silicon 執行 ffmpeg 失敗，請先安裝 Rosetta：softwareupdate --install-rosetta --agree-to-license）"
