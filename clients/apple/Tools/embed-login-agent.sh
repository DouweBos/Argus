#!/bin/zsh
# The launchd agent behind Argus Server's Open at Login (ArgusMenuBar/Lifecycle/
# LoginItem.swift), embedded where SMAppService looks for it. KeepAlive on an
# unsuccessful exit brings the app back after a crash; Quit exits 0.
set -euo pipefail

label="$PRODUCT_BUNDLE_IDENTIFIER.agent"
dir="$TARGET_BUILD_DIR/$CONTENTS_FOLDER_PATH/Library/LaunchAgents"
mkdir -p "$dir"
cat > "$dir/$label.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>$label</string>
	<key>BundleProgram</key>
	<string>Contents/MacOS/$EXECUTABLE_NAME</string>
	<key>AssociatedBundleIdentifiers</key>
	<array>
		<string>$PRODUCT_BUNDLE_IDENTIFIER</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<dict>
		<key>SuccessfulExit</key>
		<false/>
	</dict>
	<key>ProcessType</key>
	<string>Interactive</string>
	<key>LimitLoadToSessionType</key>
	<string>Aqua</string>
</dict>
</plist>
PLIST
