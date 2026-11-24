#!/bin/zsh
# Double-click in Finder to launch Golden Hour Riding
set -euo pipefail

cd "$(dirname "$0")"

# Ensure Homebrew / nvm / standard Node locations are on PATH when launched from Finder
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/$(ls -1 "$HOME/.nvm/versions/node" 2>/dev/null | tail -n 1)/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display dialog "Node.js is required to run Golden Hour Riding from source.\n\nInstall Node.js 20+ from https://nodejs.org/ or run the packaged .app from release/." buttons {"OK"} default button 1 with icon stop'
  exit 1
fi

if [ ! -d "node_modules" ]; then
  npm install
fi

# Build native macOS voice helper if missing or updated
if [ ! -x "electron/voice/mac-speech" ] || [ "electron/voice/mac-speech.swift" -nt "electron/voice/mac-speech" ]; then
  if command -v swiftc >/dev/null 2>&1; then
    npm run build:voice:mac
  fi
fi

# Rebuild dist/ if missing or if any file in src/ or index.html is newer than dist/index.html
if [ ! -f "dist/index.html" ] || [ -n "$(find src index.html -newer dist/index.html 2>/dev/null | head -n 1)" ]; then
  npm run build
fi

nohup ./node_modules/.bin/electron . >/dev/null 2>&1 &
disown
osascript -e 'tell application "Terminal" to close front window' >/dev/null 2>&1 &
exit 0
