#!/bin/bash
# Build script for Claude Monitor - generates Chrome and Firefox packages

VERSION=$(grep '"version"' manifest.json | head -1 | sed 's/.*: *"\(.*\)".*/\1/')
echo "Building Claude Monitor v${VERSION}..."

DIST="dist"
rm -rf "$DIST"
mkdir -p "$DIST"

# Shared files (everything except manifests and build artifacts)
SHARED_FILES="background.js popup.html popup.js popup.css settings.html settings.js settings.css history.html history.js history.css icons/"

# -- Chrome --
CHROME_DIR="$DIST/chrome"
mkdir -p "$CHROME_DIR"
for f in $SHARED_FILES; do
  cp -r "$f" "$CHROME_DIR/"
done
cp manifest.json "$CHROME_DIR/manifest.json"

powershell -Command "Compress-Archive -Path '${CHROME_DIR}/*' -DestinationPath '${DIST}/claude-monitor-${VERSION}-chrome.zip' -Force" 2>/dev/null
echo "  Chrome: dist/claude-monitor-${VERSION}-chrome.zip"

# -- Firefox --
FIREFOX_DIR="$DIST/firefox"
mkdir -p "$FIREFOX_DIR"
for f in $SHARED_FILES; do
  cp -r "$f" "$FIREFOX_DIR/"
done
cp manifest.firefox.json "$FIREFOX_DIR/manifest.json"

powershell -Command "Compress-Archive -Path '${FIREFOX_DIR}/*' -DestinationPath '${DIST}/claude-monitor-${VERSION}-firefox.zip' -Force" 2>/dev/null
echo "  Firefox: dist/claude-monitor-${VERSION}-firefox.zip"

echo "Done!"
