#!/bin/bash
# Builds Focus Reader and installs it into /Applications.
set -o pipefail
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get the LTS from https://nodejs.org, then run this again."
  exit 1
fi

echo "Project: $PWD"
echo "Node:    $(node -v)"
echo

if [ ! -d node_modules ]; then
  echo "==> Installing dependencies (first run only, ~1 min)..."
  npm install || { echo "npm install failed - see above."; exit 1; }
  echo
fi

echo "==> Building..."
npm run dist || { echo "Build failed - see above."; exit 1; }

APP=$(find dist -maxdepth 2 -name "Focus Reader.app" -print -quit)
if [ -z "$APP" ]; then
  echo "Build finished but no Focus Reader.app was found under dist/."
  exit 1
fi

echo
echo "==> Installing to /Applications..."
rm -rf "/Applications/Focus Reader.app"
cp -R "$APP" /Applications/ || { echo "Could not copy into /Applications. The app is here: $PWD/$APP"; exit 1; }
xattr -dr com.apple.quarantine "/Applications/Focus Reader.app" 2>/dev/null

echo
echo "Done. Focus Reader is now in /Applications."
echo "First launch: right-click it in Finder and choose Open (it is unsigned)."
open -R "/Applications/Focus Reader.app"
