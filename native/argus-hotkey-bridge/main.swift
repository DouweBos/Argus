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
// granted to a bundle that has accessibility-relevant entitlements.
//
// Important: macOS Accessibility (TCC) is granted per-binary by code
// signature, NOT inherited from the parent process. So this helper needs
// its OWN entry in System Settings → Privacy & Security → Accessibility,
// independent of Argus.app's entry. To make that possible we (a) embed an
// Info.plist via `-sectcreate __TEXT __info_plist` (see Makefile), and
// (b) initialize NSApplication below — without an NSApplication event
// loop, the AXIsProcessTrustedWithOptions prompt UI is silently skipped
// and the user has no way to grant the permission this helper needs.
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

func logStderr(_ msg: String) {
    FileHandle.standardError.write(Data((msg + "\n").utf8))
}

// ---------------------------------------------------------------------------
// Right-Option detection
// ---------------------------------------------------------------------------
//
// Apple uses key code 61 for Right Option (58 = Left Option). flagsChanged
// fires once when the modifier goes down and once when it comes back up — we
// detect the down-edge by checking whether the shared `.option` bit is set
// after the change. Two down-edges within `doublePressWindow` fire `trigger`.
//
// We intentionally do NOT filter on the device-dependent right-option bit
// (`NX_DEVICERALTKEYMASK = 0x40`): on recent macOS versions
// `NSEvent.modifierFlags` may strip device-dependent bits depending on
// keyboard model, which silently broke detection (event.keyCode is the
// authoritative right/left discriminator anyway).

let rightOptionKeyCode: UInt16 = 61
let doublePressWindow: TimeInterval = 0.35

var lastPressAt: TimeInterval = 0

func handleFlagsChanged(_ event: NSEvent) {
    guard event.keyCode == rightOptionKeyCode else { return }
    // Down-edge = option flag is set after this flagsChanged.
    let pressed = event.modifierFlags.contains(.option)
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
// AppKit setup
// ---------------------------------------------------------------------------
//
// We need an NSApplication for two reasons: (1) AXIsProcessTrustedWithOptions
// can only surface its prompt dialog when there's an NSApplication event loop
// running, and (2) global event monitors need to be installed after AppKit
// has finished early init. LSUIElement=true (in our embedded Info.plist)
// keeps us out of the Dock; .accessory keeps us out of the menu bar focus.

final class HotkeyDelegate: NSObject, NSApplicationDelegate {
    var globalMonitor: Any?
    var localMonitor: Any?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Pass `kAXTrustedCheckOptionPrompt: true` so the first launch surfaces
        // the macOS Accessibility dialog instead of silently failing. Without
        // this option, the OS only *checks* trust — it never prompts.
        let promptKey = kAXTrustedCheckOptionPrompt.takeUnretainedValue()
        let options = [promptKey: true] as CFDictionary
        let trusted = AXIsProcessTrustedWithOptions(options)
        emit(["event": "ready", "accessibility_granted": trusted])

        if !trusted {
            emit(["event": "permission_denied"])
        }

        globalMonitor = NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged) { event in
            handleFlagsChanged(event)
        }

        // Also watch local events so the same chord works when Argus itself is
        // the frontmost app — global monitors don't fire for the active process.
        localMonitor = NSEvent.addLocalMonitorForEvents(matching: .flagsChanged) { event in
            handleFlagsChanged(event)
            return event
        }

        // Clean exit on stdin EOF — when the parent process dies or closes our
        // stdin (e.g. on `child.kill()`), tear down monitors and quit.
        DispatchQueue.global(qos: .utility).async { [weak self] in
            let stdin = FileHandle.standardInput
            while true {
                let chunk = stdin.availableData
                if chunk.isEmpty {
                    DispatchQueue.main.async {
                        emit(["event": "exit", "reason": "stdin_closed"])
                        if let m = self?.globalMonitor { NSEvent.removeMonitor(m) }
                        if let m = self?.localMonitor { NSEvent.removeMonitor(m) }
                        exit(0)
                    }
                    return
                }
            }
        }
    }
}

let app = NSApplication.shared
let delegate = HotkeyDelegate()
app.delegate = delegate
// .accessory: no Dock icon, no menu bar, but still a valid NSApplication for
// AX prompts and event monitors. Pairs with LSUIElement=true in Info.plist.
app.setActivationPolicy(.accessory)
app.run()
