#!/bin/zsh
# Double-click in Finder to launch the Godot 4 Golden Hour Prototype
set -euo pipefail
cd "$(dirname "$0")"
open -n -a /Applications/Godot.app --args --path "$PWD/godot-prototype"
sleep 0.5
osascript -e 'tell application "Terminal" to close front window' >/dev/null 2>&1 &
exit 0
