#!/usr/bin/env bash
# Install the Codex Micro daemon as a launchd LaunchAgent so exec-style
# key bindings (Enter key, mic fn) work when no pi session is running.
# The daemon steps aside whenever a live pi session owns an agent slot.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
TSX="$REPO/node_modules/.bin/tsx"
LABEL="com.worklouder.codex-micro"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/.pi/agent"

if [ ! -x "$TSX" ]; then
  echo "tsx not found at $TSX — run npm install in $REPO first." >&2
  exit 1
fi

mkdir -p "$(dirname "$PLIST")" "$LOG_DIR"

# Compile the Swift helpers the bindings and focus logic rely on.
if command -v swiftc >/dev/null 2>&1; then
  for helper in frontapp fnkey keysend; do
    if [ -f "$REPO/scripts/$helper.swift" ]; then
      swiftc -O "$REPO/scripts/$helper.swift" -o "$LOG_DIR/$helper" && echo "built $helper"
    fi
  done
else
  echo "swiftc not found — install Xcode CLT to build key helpers." >&2
fi

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$TSX</string>
    <string>$REPO/scripts/microd.mts</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG_DIR/microd.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/microd.log</string>
</dict>
</plist>
PLISTEOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Loaded $LABEL."
echo "Log: $LOG_DIR/microd.log"
echo "Uninstall: launchctl unload $PLIST && rm $PLIST"
