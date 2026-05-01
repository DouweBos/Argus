// argus-hotkey-bridge
//
// Standalone macOS binary that watches global keyboard events for a
// double-press of the right Option key and emits a JSON event on stdout.
//
// Spawned as a child process by Electron's main process. JSON-over-stdio
// keeps the integration the same shape as `argus-sim-bridge`.
//
// Why a separate binary? Electron's `globalShortcut` can't observe bare
// modifier keys, and `NSEvent.addGlobalMonitorForEvents` requires the
// macOS Accessibility ("Input Monitoring") permission — which has to be
// granted to a bundle that has accessibility-relevant entitlements. The
// Electron app gets the permission once and re-uses it for every spawn.
//
// Output protocol (one JSON object per line):
//   { "event": "ready",              "accessibility_granted": <bool> }
//   { "event": "trigger" }                       // double-press detected
//   { "event": "permission_denied" }             // process is not trusted
//   { "event": "exit",   "reason": "<string>" }  // emitted before quit

import AppKit
import Foundation

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

func emit(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj, options: []),
          let line = String(data: data, encoding: .utf8) else {
        return
    }
    FileHandle.standardOutput.write(Data((line + "\n").utf8))
}

// ---------------------------------------------------------------------------
// Right-Option detection
// ---------------------------------------------------------------------------
//
// Apple uses key code 61 for Right Option. We watch flagsChanged events and
// treat each "right-option flag turned on" as a press. Two presses inside
// `doublePressWindow` fire a `trigger`.
//
// The `NSEvent.ModifierFlags.option` bit is shared between left and right
// Option, so we filter on the device-dependent flag bit `0x40`
// (NX_DEVICERALTKEYMASK) for reliable side discrimination.

let rightOptionKeyCode: UInt16 = 61
let rightOptionFlagBit: UInt = 0x40
let doublePressWindow: TimeInterval = 0.35

var lastPressAt: TimeInterval = 0

func handleFlagsChanged(_ event: NSEvent) {
    guard event.keyCode == rightOptionKeyCode else { return }
    let pressed = (event.modifierFlags.rawValue & rightOptionFlagBit) != 0
    guard pressed else { return }

    let now = Date().timeIntervalSince1970
    if now - lastPressAt <= doublePressWindow {
        emit(["event": "trigger"])
        lastPressAt = 0
    } else {
        lastPressAt = now
    }
}

// ---------------------------------------------------------------------------
// Permission + monitor setup
// ---------------------------------------------------------------------------

// Pass `kAXTrustedCheckOptionPrompt: true` so the first launch surfaces the
// macOS Accessibility dialog instead of silently failing. Without this
// option, the OS only *checks* trust — it never prompts, which is why users
// see "the native helper isn't running" with no way to grant permission.
let promptKey = kAXTrustedCheckOptionPrompt.takeUnretainedValue()
let options = [promptKey: true] as CFDictionary
let trusted = AXIsProcessTrustedWithOptions(options)
emit(["event": "ready", "accessibility_granted": trusted])

if !trusted {
    // Without Accessibility permission the global monitor silently no-ops.
    // Surface that fact so the parent can prompt the user instead of
    // looking like the feature is broken.
    emit(["event": "permission_denied"])
}

let monitor = NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged) { event in
    handleFlagsChanged(event)
}

// Also watch local events so the same chord works when Argus itself is the
// frontmost app — global monitors don't fire for the active process.
let localMonitor = NSEvent.addLocalMonitorForEvents(matching: .flagsChanged) { event in
    handleFlagsChanged(event)
    return event
}

// Clean exit on stdin EOF — when the parent process dies or closes our
// stdin (e.g. on `child.kill()`), we tear down the monitor and quit.
DispatchQueue.global(qos: .utility).async {
    let stdin = FileHandle.standardInput
    while true {
        let chunk = stdin.availableData
        if chunk.isEmpty {
            DispatchQueue.main.async {
                emit(["event": "exit", "reason": "stdin_closed"])
                if let m = monitor { NSEvent.removeMonitor(m) }
                if let m = localMonitor { NSEvent.removeMonitor(m) }
                exit(0)
            }

            return
        }
    }
}

// Run the AppKit main loop so the global monitor's callbacks fire.
RunLoop.main.run()
