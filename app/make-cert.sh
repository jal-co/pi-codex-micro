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

# Import the key and cert as separate PEMs (avoids PKCS12 MAC/algorithm
# mismatches between OpenSSL 3 and the macOS security tool).
security import "$TMP/key.pem" -k "$KEYCHAIN" -T /usr/bin/codesign >/dev/null
security import "$TMP/cert.pem" -k "$KEYCHAIN" -T /usr/bin/codesign >/dev/null

echo "Created code-signing identity: $CERT_NAME"
echo "Rebuild the app; permission grants will now persist across rebuilds."
