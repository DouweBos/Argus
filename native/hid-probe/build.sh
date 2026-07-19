#!/bin/bash
# Build HIDProbe into a simulator .app bundle (no Xcode project needed) and,
# if a UDID is given, install + launch it on that booted simulator.
#
#   ./build.sh                 # build only
#   ./build.sh <UDID>          # build, install, launch
set -euo pipefail
cd "$(dirname "$0")"

SDK=$(xcrun --sdk iphonesimulator --show-sdk-path)
APP=build/HIDProbe.app
BUNDLE_ID=com.argus.hidprobe

rm -rf build && mkdir -p "$APP"

xcrun -sdk iphonesimulator swiftc \
    -target arm64-apple-ios17.0-simulator \
    -sdk "$SDK" \
    -O \
    -parse-as-library \
    HIDProbe.swift \
    -o "$APP/HIDProbe"

cp Info.plist "$APP/Info.plist"
echo "built $APP"

UDID="${1:-}"
if [ -n "$UDID" ]; then
    xcrun simctl install "$UDID" "$APP"
    xcrun simctl launch "$UDID" "$BUNDLE_ID"
fi
