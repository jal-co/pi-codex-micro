#!/usr/bin/env bash
# Create a stable self-signed code-signing identity so rebuilds of the
# app keep the same signature, and macOS keeps its Input Monitoring +
# Accessibility grants across rebuilds. Idempotent: does nothing if the
# identity already exists. Run once.
set -euo pipefail

CERT_NAME="Codex Micro Bridge Dev"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"

if security find-identity -v -p codesigning | grep -q "$CERT_NAME"; then
  echo "Identity already present: $CERT_NAME"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

openssl req -newkey rsa:2048 -nodes -keyout "$TMP/key.pem" \
  -x509 -days 3650 -out "$TMP/cert.pem" \
  -subj "/CN=$CERT_NAME" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning" >/dev/null 2>&1

openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" \
  -out "$TMP/id.p12" -name "$CERT_NAME" -passout pass:cmb >/dev/null 2>&1

security import "$TMP/id.p12" -k "$KEYCHAIN" -P cmb -T /usr/bin/codesign >/dev/null

echo "Created code-signing identity: $CERT_NAME"
echo "Rebuild the app; permission grants will now persist across rebuilds."
