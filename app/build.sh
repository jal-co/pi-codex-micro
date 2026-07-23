#!/usr/bin/env bash
# Build "Codex Micro Bridge.app" — a menu-bar agent that reads the
# Codex Micro HID and posts keystrokes in-process. A real .app bundle
# gives a stable TCC identity, so Input Monitoring + Accessibility
# grants persist (unlike bare binaries spawned by node).
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$DIR/build/Codex Micro Bridge.app"
BUNDLE_ID="cc.worklouder.codex-micro-bridge"
CERT_NAME="Codex Micro Bridge Dev"
MACOS="$APP/Contents/MacOS"
RES="$APP/Contents/Resources"

rm -rf "$APP"
mkdir -p "$MACOS" "$RES"

# Build the app icon (AppIcon.icns) from the Swift renderer.
if command -v swiftc >/dev/null 2>&1; then
  swiftc -O "$DIR/make-icon.swift" -o "$DIR/build/make-icon" 2>/dev/null && "$DIR/build/make-icon" "$DIR/build/icon.png"
  if [ -f "$DIR/build/icon.png" ]; then
    ICONSET="$DIR/build/AppIcon.iconset"
    rm -rf "$ICONSET"; mkdir -p "$ICONSET"
    for s in 16 32 64 128 256 512 1024; do
      sips -z $s $s "$DIR/build/icon.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null 2>&1
    done
    cp "$ICONSET/icon_32x32.png" "$ICONSET/icon_16x16@2x.png"
    cp "$ICONSET/icon_64x64.png" "$ICONSET/icon_32x32@2x.png"
    cp "$ICONSET/icon_256x256.png" "$ICONSET/icon_128x128@2x.png"
    cp "$ICONSET/icon_512x512.png" "$ICONSET/icon_256x256@2x.png"
    cp "$ICONSET/icon_1024x1024.png" "$ICONSET/icon_512x512@2x.png"
    iconutil -c icns "$ICONSET" -o "$RES/AppIcon.icns" 2>/dev/null || true
  fi
fi

cat > "$APP/Contents/Info.plist" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Codex Micro Bridge</string>
  <key>CFBundleDisplayName</key><string>Codex Micro Bridge</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleVersion</key><string>0.1.0</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleExecutable</key><string>CodexMicroBridge</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHumanReadableCopyright</key><string>MIT</string>
</dict>
</plist>
PLISTEOF

# Bundle the config web UI.
cp "$DIR/Resources/config.html" "$RES/config.html"

swiftc -O \
  -framework AppKit -framework IOKit -framework WebKit \
  "$DIR/Sources/main.swift" \
  -o "$MACOS/CodexMicroBridge"

# Sign with the stable self-signed identity when present (grants then
# survive rebuilds); otherwise fall back to ad-hoc. Run make-cert.sh
# once to create the identity.
if security find-identity -v -p codesigning 2>/dev/null | grep -q "$CERT_NAME"; then
  codesign --force --sign "$CERT_NAME" "$APP"
  echo "Signed with stable identity: $CERT_NAME"
else
  codesign --force --sign - "$APP"
  echo "Ad-hoc signed (run app/make-cert.sh once for persistent grants)."
fi

echo "Built: $APP"
echo "Run once to register, then grant Input Monitoring + Accessibility:"
echo "  open \"$APP\""
