#!/usr/bin/env bash
#
# Install (or reinstall) the launchd agent that keeps Argus Server running.
#
# Usage: scripts/install-server-agent.sh [/path/to/Argus Server.app]
#        scripts/install-server-agent.sh --uninstall
#
# An agent, not a daemon — `simctl boot` needs a logged-in Aqua session, so the
# mini must be set to auto-login. See docs/server-app.md.

set -euo pipefail

cat >&2 <<'NOTE'
Deprecated: this is for the old (Electron) Argus Server. The native Argus
Server starts itself at login: use "Open at Login" in its menu bar item instead.
NOTE

LABEL="dev.houwert.argus.server"
PLIST_DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$REPO_ROOT/build/$LABEL.plist"

unload() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
}

if [[ "${1:-}" == "--uninstall" ]]; then
  unload
  rm -f "$PLIST_DEST"
  echo "Removed $PLIST_DEST"
  exit 0
fi

APP="${1:-/Applications/Argus Server.app}"
if [[ ! -x "$APP/Contents/MacOS/Argus Server" ]]; then
  echo "No Argus Server.app at: $APP" >&2
  echo "Build it with \`pnpm build:app:server\` and copy it to /Applications." >&2
  exit 1
fi

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.argus-server"
sed -e "s|@APP@|$APP|g" -e "s|@HOME@|$HOME|g" "$TEMPLATE" >"$PLIST_DEST"

unload
launchctl bootstrap "gui/$(id -u)" "$PLIST_DEST"
launchctl kickstart -k "gui/$(id -u)/$LABEL"

echo "Installed $PLIST_DEST"
echo "Logs: ~/.argus-server/launchd.out.log"
