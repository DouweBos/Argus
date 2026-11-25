#!/bin/sh
# Builds and runs Argus Dev through LaunchServices, so macOS asks for the microphone
# and camera in its own name instead of the app that started this script.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
port=${ARGUS_PORT:-1420}
app="$root/.build/mac-dd/Build/Products/Debug/Argus.app"
exe="$app/Contents/MacOS/Argus"
log="$root/.build/mac-dd/argus-dev.log"

# Not -quiet: Xcode 27 reports a compile step with only warnings as "failed with exit code 0" there.
build_log="$root/.build/mac-dd/build.log"
mkdir -p "$(dirname "$build_log")"
if ! xcodebuild -project "$root/clients/apple/ArgusRemote.xcodeproj" -scheme ArgusDesktop \
  -destination 'platform=macOS,arch=arm64' -derivedDataPath "$root/.build/mac-dd" build >"$build_log" 2>&1; then
  grep -E ': error: |^error: ' "$build_log" | grep -v 'failed with exit code 0' || tail -30 "$build_log"
  echo "Build failed; full log in $build_log" >&2
  exit 1
fi

: >"$log"
tail -f "$log" &
tailer=$!
app_pid=

stop() {
  [ -n "$app_pid" ] && kill "$app_pid" 2>/dev/null || true
  kill "$tailer" 2>/dev/null || true
}
trap stop EXIT
trap 'exit 130' INT TERM HUP

# Other dev instances of this build may be running; only stop the one launched here.
before=$(pgrep -xf "$exe" || true)
open -n -W "$app" --stdout "$log" --stderr "$log" \
  --env ARGUS_HOME="$HOME/.argus-mac-dev-$port" \
  --env ARGUS_REMOTE_PORT=$((48016 + port - 1420)) &
opener=$!
for _ in $(seq 50); do
  for pid in $(pgrep -xf "$exe" || true); do
    echo "$before" | grep -qx "$pid" || app_pid=$pid
  done
  [ -n "$app_pid" ] && break
  sleep 0.1
done
wait "$opener"
