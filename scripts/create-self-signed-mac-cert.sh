#!/usr/bin/env bash
# Create the stable free macOS signing certificate used when Developer ID
# credentials are not available. Keep the generated files private: the .p12
# contains the signing private key.
set -euo pipefail
IFS=$'\n\t'

if [[ "$#" -ne 1 ]]; then
  echo "Usage: bash scripts/create-self-signed-mac-cert.sh <private-output-directory>" >&2
  exit 1
fi

for required_command in openssl base64 chmod mkdir; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "Missing required command: $required_command" >&2
    exit 1
  fi
done

readonly CERT_NAME="Lingxiu Cover Stable Signing"
readonly OUTPUT_DIR="$1"
readonly KEY_PATH="$OUTPUT_DIR/lingxiu-cover-stable-signing.key.pem"
readonly CERT_PATH="$OUTPUT_DIR/lingxiu-cover-stable-signing.cert.pem"
readonly P12_PATH="$OUTPUT_DIR/MAC_SELF_SIGNED_CSC_LINK.p12"
readonly BASE64_PATH="$OUTPUT_DIR/MAC_SELF_SIGNED_CSC_LINK.base64.txt"
readonly PASSWORD_PATH="$OUTPUT_DIR/MAC_SELF_SIGNED_CSC_KEY_PASSWORD.txt"

mkdir -p "$OUTPUT_DIR"
for existing in "$KEY_PATH" "$CERT_PATH" "$P12_PATH" "$BASE64_PATH" "$PASSWORD_PATH"; do
  if [[ -e "$existing" ]]; then
    echo "Refusing to overwrite existing signing material: $existing" >&2
    exit 1
  fi
done

password="$(openssl rand -hex 24)"
printf '%s\n' "$password" > "$PASSWORD_PATH"

openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -subj "/CN=$CERT_NAME/O=Living Water Church Chiayi/OU=Zoomshare/" \
  -addext "keyUsage=digitalSignature" \
  -addext "extendedKeyUsage=codeSigning" \
  -keyout "$KEY_PATH" \
  -out "$CERT_PATH"

openssl pkcs12 -legacy -export \
  -out "$P12_PATH" \
  -inkey "$KEY_PATH" \
  -in "$CERT_PATH" \
  -name "$CERT_NAME" \
  -passout "pass:$password"

base64 < "$P12_PATH" | tr -d '\n' > "$BASE64_PATH"
chmod 600 "$KEY_PATH" "$P12_PATH" "$PASSWORD_PATH" "$BASE64_PATH"

echo "Created stable self-signed signing material in: $OUTPUT_DIR"
echo "Set GitHub secrets from these files:"
echo "  MAC_SELF_SIGNED_CSC_LINK=$BASE64_PATH"
echo "  MAC_SELF_SIGNED_CSC_KEY_PASSWORD=$PASSWORD_PATH"
