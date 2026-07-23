#!/usr/bin/env bash
# Build "Codex Micro Bridge.app" — a menu-bar agent that reads the
# Codex Micro HID and posts keystrokes in-process. A real .app bundle
# gives a stable TCC identity, so Input Monitoring + Accessibility
# grants persist (unlike bare binaries spawned by node).
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$DIR/build/Codex Micro Bridge.app"
BUNDLE_ID="cc.worklouder.codex-micro-bridge"
MACOS="$APP/Contents/MacOS"

rm -rf "$APP"
mkdir -p "$MACOS" "$APP/Contents/Resources"

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
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHumanReadableCopyright</key><string>MIT</string>
</dict>
</plist>
PLISTEOF

swiftc -O \
  -framework AppKit -framework IOKit \
  "$DIR/Sources/main.swift" \
  -o "$MACOS/CodexMicroBridge"

# Ad-hoc sign so the bundle has a stable TCC identity on this machine.
codesign --force --sign - "$APP"

echo "Built: $APP"
echo "Run once to register, then grant Input Monitoring + Accessibility:"
echo "  open \"$APP\""
