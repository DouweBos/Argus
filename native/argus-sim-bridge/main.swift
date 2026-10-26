// main.swift — JSON-over-stdio entry point for the argus-sim-bridge binary.
//
// Reads newline-delimited JSON commands from stdin, dispatches them to the
// Swift/ObjC simulation layer (ArgusBridge.swift + ArgusHID.m), and
// writes JSON responses back to stdout.
//
// Protocol:
//   {"cmd":"start_capture","udid":"..."}              → {"ok":true,"port":12345}
//   {"cmd":"stop_capture"}                            → {"ok":true}
//   {"cmd":"start_remote_stream","bitrate":3000000,"maxDim":1280,"fps":30}
//                                                     → {"ok":true,"port":12346}
//   {"cmd":"set_stream_params","bitrate":800000,"maxDim":960,"fps":30}
//                                                     → {"ok":true}
//   {"cmd":"stop_remote_stream"}                      → {"ok":true}
//   {"cmd":"refresh_display"}                         → {"ok":true}
//   {"cmd":"display_info"}    → {"ok":true,"width":..,"height":..,"uiOrientation":..}
//   {"cmd":"touch","udid":"...","x":0.5,"y":0.5,"type":0}  → {"ok":true}
//   {"cmd":"button","udid":"...","button":"home"}          → {"ok":true}
//   {"cmd":"keyboard","udid":"...","keyCode":36,
//           "modifierFlags":0,"isDown":true}               → {"ok":true}
//
// One response is written per command, flush is forced after each write so
// the parent process receives the response without buffering delays.

import Foundation

// Ignore SIGPIPE — macOS sends this when we write to a socket the client has
// closed (e.g. a popout window mirroring the stream is closed). The default
// disposition terminates the process, which would tear down the bridge and
// kill all remaining clients (including the main window's stream). writeAll
// already handles the EPIPE return value and closes the broken client cleanly.
signal(SIGPIPE, SIG_IGN)

// ---------------------------------------------------------------------------
// MARK: - Bridge functions
// ---------------------------------------------------------------------------

// csStartFramebuffer, csStopFramebuffer, scIndigoTouch, scIndigoKeyboard
// are defined in ArgusBridge.swift (compiled in the same module) and
// callable directly — no forward declarations needed.

// ---------------------------------------------------------------------------
// MARK: - Raw H.264 TCP server
// ---------------------------------------------------------------------------

/// Tracks connected streaming clients and fans out encoded H.264 Annex B
/// chunks to each of them in order. Unlike the old MJPEG server there are no
/// HTTP headers — each client receives the raw elementary byte stream, which
/// the Node side parses with H264AccessUnitParser.
private final class StreamHub {
    private var clients: [Int32] = []
    private let lock = NSLock()
    private let requestKeyframe: () -> Void

    init(requestKeyframe: @escaping () -> Void) {
        self.requestKeyframe = requestKeyframe
    }

    func addClient(_ fd: Int32) {
        lock.lock()
        clients.append(fd)
        lock.unlock()
        // A new subscriber needs a keyframe (SPS/PPS + IDR) to start decoding.
        requestKeyframe()
    }

    /// Write one encoded chunk to every connected client, in order. Clients
    /// whose socket write fails (closed/broken connection) are dropped.
    func broadcast(_ data: Data) {
        lock.lock()
        let snapshot = clients
        lock.unlock()
        if snapshot.isEmpty { return }

        var dead: [Int32] = []
        for fd in snapshot where !writeAll(fd, data) {
            dead.append(fd)
        }
        if !dead.isEmpty {
            lock.lock()
            clients.removeAll { dead.contains($0) }
            lock.unlock()
            for fd in dead { close(fd) }
        }
    }
}

private let streamHub = StreamHub(requestKeyframe: { SHRequestKeyframe() })

/// The bitrate-capped stream for remote viewers, on its own port so the host
/// can parse it independently of the full-quality local stream.
private let remoteHub = StreamHub(requestKeyframe: { SHRequestRemoteKeyframe() })
private var remotePort: UInt16?

/// C-callable frame callback invoked by cs_start_framebuffer at ~30fps with
/// H.264 Annex B chunks (one access unit per call).
private let frameCallback: @convention(c) (UnsafePointer<UInt8>, UInt) -> Void = {
    ptr, len in
    let bytes = Data(bytes: ptr, count: Int(len))
    streamHub.broadcast(bytes)
}

private let remoteFrameCallback: @convention(c) (UnsafePointer<UInt8>?, UInt) -> Void = {
    ptr, len in
    guard let ptr else { return }
    remoteHub.broadcast(Data(bytes: ptr, count: Int(len)))
}

/// The remote stream's target, as sent by the host's congestion controller.
private func remoteParams(_ obj: [String: Any]) -> (bitrate: Int32, maxDim: Int32, fps: Int32)? {
    guard let bitrate = obj["bitrate"] as? Int, let maxDim = obj["maxDim"] as? Int else {
        return nil
    }
    let fps = obj["fps"] as? Int ?? 30
    return (Int32(clamping: bitrate), Int32(clamping: maxDim), Int32(clamping: fps))
}

/// Write all bytes to a file descriptor, handling short writes.
private func writeAll(_ fd: Int32, _ data: Data) -> Bool {
    var remaining = data
    while !remaining.isEmpty {
        let written = remaining.withUnsafeBytes { ptr -> Int in
            guard let base = ptr.baseAddress else { return -1 }
            return write(fd, base, ptr.count)
        }
        if written <= 0 { return false }
        remaining = remaining.dropFirst(written)
    }
    return true
}

/// Bind a TCP listener on a random port, start accepting raw H.264 stream
/// clients, and return the bound port number.
private func startStreamServer(hub: StreamHub) throws -> UInt16 {
    // Create a TCP socket
    let serverFd = socket(AF_INET, SOCK_STREAM, 0)
    guard serverFd >= 0 else {
        throw NSError(domain: "SimBridge", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: "socket() failed"])
    }

    var opt: Int32 = 1
    setsockopt(serverFd, SOL_SOCKET, SO_REUSEADDR, &opt, socklen_t(MemoryLayout<Int32>.size))

    var addr = sockaddr_in()
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = 0  // let OS pick a port
    // Loopback only: the stream is unauthenticated; remote viewers go through the gateway.
    addr.sin_addr.s_addr = INADDR_LOOPBACK.bigEndian

    let bindResult = withUnsafePointer(to: &addr) { ptr -> Int32 in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
            bind(serverFd, sockPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
    }
    guard bindResult == 0 else {
        close(serverFd)
        throw NSError(domain: "SimBridge", code: 2,
                      userInfo: [NSLocalizedDescriptionKey: "bind() failed"])
    }

    guard listen(serverFd, 8) == 0 else {
        close(serverFd)
        throw NSError(domain: "SimBridge", code: 3,
                      userInfo: [NSLocalizedDescriptionKey: "listen() failed"])
    }

    // Read back the assigned port
    var boundAddr = sockaddr_in()
    var addrLen = socklen_t(MemoryLayout<sockaddr_in>.size)
    withUnsafeMutablePointer(to: &boundAddr) { ptr in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockPtr in
            _ = getsockname(serverFd, sockPtr, &addrLen)
        }
    }
    let port = UInt16(bigEndian: boundAddr.sin_port)

    // Accept clients in a background thread. The stream hub fans encoded
    // frames out to every connected client from the encoder callback, so no
    // per-client serving thread is needed.
    Thread.detachNewThread {
        while true {
            let clientFd = accept(serverFd, nil, nil)
            guard clientFd >= 0 else { break }
            hub.addClient(clientFd)
        }
        close(serverFd)
    }

    return port
}

// ---------------------------------------------------------------------------
// MARK: - Button name → keycode mapping
//
// Mirrors keyboard.rs `button_to_key`.
// ---------------------------------------------------------------------------

private struct KeyMapping {
    let keycode: UInt16
    let flags: UInt64
}

private func buttonToKey(_ button: String) -> KeyMapping? {
    switch button {
    // tvOS remote buttons
    case "up":        return KeyMapping(keycode: 126, flags: 0)
    case "down":      return KeyMapping(keycode: 125, flags: 0)
    case "left":      return KeyMapping(keycode: 123, flags: 0)
    case "right":     return KeyMapping(keycode: 124, flags: 0)
    case "select":    return KeyMapping(keycode: 36,  flags: 0)   // Return
    case "menu":      return KeyMapping(keycode: 53,  flags: 0)   // Escape
    case "playpause": return KeyMapping(keycode: 49,  flags: 0)   // Space
    case "home":      return KeyMapping(keycode: 115, flags: 0)   // Home (TV button)
    default:          return nil
    }
}

// The Siri Remote rides the HID Consumer page (0x0C) menu-navigation usages.
// tvOS ignores emulated keyboard key codes entirely, so these are the only way
// to reach its focus engine.
private let hidConsumerPage: UInt32 = 0x0C

private func remoteButtonToUsage(_ button: String) -> UInt32? {
    switch button {
    case "menu":      return 0x40
    case "select":    return 0x41
    case "up":        return 0x42
    case "down":      return 0x43
    case "left":      return 0x44
    case "right":     return 0x45
    case "home":      return 0x30
    case "playpause": return 0xCD
    default:          return nil
    }
}

// iOS hardware buttons routed through IndigoHIDMessageForButton (real button
// HID) instead of a faked keyboard chord — doesn't depend on a focused keyboard
// responder and can't misfire as text.
//
// `target` is SimDeviceScreen.buttonTarget: 51 for a device's primary internal
// display (the 21 variant is for secondary/external displays). An invalid target
// aborts backboardd, so this is intentionally a single verified constant rather
// than a guess.
//
// Simulators ignore this whole path — the message sends without error and
// nothing reaches the device, for every keyCode and every target, on every
// runtime from iOS 18.3 up. Keyboard and buttons are injected from inside the
// guest instead (see argus-sim-input). Also note keyCode 1 is Power, not Home;
// SimDisplayChromeView maps Home (Consumer usage 0x40) to 0x191.
private let iosButtonTarget: UInt32 = 51

private func iosHardwareButtonKeyCode(_ button: String) -> UInt32? {
    switch button {
    case "ios_home": return 1
    default:         return nil
    }
}

// ---------------------------------------------------------------------------
// MARK: - JSON I/O helpers
// ---------------------------------------------------------------------------

private func writeResponse(_ dict: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: dict),
          let line = String(data: data, encoding: .utf8) else {
        // Fallback — write a plain error response
        print("{\"ok\":false,\"error\":\"failed to serialize response\"}")
        fflush(stdout)
        return
    }
    print(line)
    fflush(stdout)
}

private func respond(ok: Bool, extras: [String: Any] = [:]) {
    var dict: [String: Any] = ["ok": ok]
    for (k, v) in extras { dict[k] = v }
    writeResponse(dict)
}

private func respondError(_ message: String) {
    writeResponse(["ok": false, "error": message])
}

// ---------------------------------------------------------------------------
// MARK: - Command dispatch
// ---------------------------------------------------------------------------

private func dispatch(_ obj: [String: Any]) {
    guard let cmd = obj["cmd"] as? String else {
        respondError("missing 'cmd' field")
        return
    }

    switch cmd {

    // ------------------------------------------------------------------
    // start_capture — start IOSurface framebuffer capture + H.264 server
    // ------------------------------------------------------------------
    case "start_capture":
        guard let udid = obj["udid"] as? String else {
            respondError("start_capture: missing 'udid'")
            return
        }

        // Start the raw H.264 TCP server first so we have a port to report
        let port: UInt16
        do {
            port = try startStreamServer(hub: streamHub)
        } catch {
            respondError("start_capture: failed to start stream server: \(error)")
            return
        }

        // Call cs_start_framebuffer (ArgusBridge.swift)
        let rc = udid.withCString { udidPtr in
            csStartFramebuffer(udidPtr, frameCallback)
        }
        guard rc == 0 else {
            respondError("start_capture: cs_start_framebuffer returned \(rc)")
            return
        }

        respond(ok: true, extras: ["port": port])

    // ------------------------------------------------------------------
    // display_info — size + UI orientation of the panel being captured
    // ------------------------------------------------------------------
    case "display_info":
        guard let info = csDisplayInfo() else {
            respondError("display_info: no display being captured")
            return
        }
        respond(ok: true, extras: [
            "width": Int(info.width),
            "height": Int(info.height),
            "uiOrientation": Int(info.uiOrientation),
            "screenID": Int(info.screenID),
        ])

    // ------------------------------------------------------------------
    // refresh_display — re-pick the live panel after a fold
    // ------------------------------------------------------------------
    case "refresh_display":
        csRefreshDisplay()
        respond(ok: true)

    // ------------------------------------------------------------------
    // stop_capture — stop IOSurface framebuffer capture
    // ------------------------------------------------------------------
    case "stop_capture":
        csStopFramebuffer()
        respond(ok: true)

    // ------------------------------------------------------------------
    // start_remote_stream — second, bitrate-capped encoder for remote viewers
    // ------------------------------------------------------------------
    case "start_remote_stream":
        guard let params = remoteParams(obj) else {
            respondError("start_remote_stream: missing 'bitrate'/'maxDim'")
            return
        }
        let port: UInt16
        if let existing = remotePort {
            port = existing
        } else {
            do {
                port = try startStreamServer(hub: remoteHub)
            } catch {
                respondError("start_remote_stream: failed to start stream server: \(error)")
                return
            }
            remotePort = port
        }
        SHStartRemoteStream(remoteFrameCallback, params.bitrate, params.maxDim, params.fps)
        respond(ok: true, extras: ["port": port])

    // ------------------------------------------------------------------
    // set_stream_params — retarget the remote stream live
    // ------------------------------------------------------------------
    case "set_stream_params":
        guard let params = remoteParams(obj) else {
            respondError("set_stream_params: missing 'bitrate'/'maxDim'")
            return
        }
        SHSetRemoteStreamParams(params.bitrate, params.maxDim, params.fps)
        respond(ok: true)

    // ------------------------------------------------------------------
    // stop_remote_stream — the last remote viewer left
    // ------------------------------------------------------------------
    case "stop_remote_stream":
        SHStopRemoteStream()
        respond(ok: true)

    // ------------------------------------------------------------------
    // touch — inject a normalized touch event via Indigo HID
    // ------------------------------------------------------------------
    case "touch":
        guard let udid = obj["udid"] as? String,
              let x = obj["x"] as? Double,
              let y = obj["y"] as? Double,
              let type_ = obj["type"] as? Int else {
            respondError("touch: missing required field(s)")
            return
        }

        let rc = udid.withCString { udidPtr in
            scIndigoTouch(udidPtr, Float(x), Float(y), Int32(type_))
        }
        if rc != 0 {
            respondError("touch: sc_indigo_touch returned \(rc)")
            return
        }
        respond(ok: true)

    // ------------------------------------------------------------------
    // button — send a named button press (down + up) via Indigo HID
    // ------------------------------------------------------------------
    case "button":
        guard let udid = obj["udid"] as? String,
              let buttonName = obj["button"] as? String else {
            respondError("button: missing required field(s)")
            return
        }

        // The Apple TV remote only responds to Consumer-page HID usages.
        if isAppleTV(udid), let usage = remoteButtonToUsage(buttonName) {
            let rcDown = udid.withCString {
                scIndigoHIDUsage($0, hidConsumerPage, usage, 1)
            }
            guard rcDown == 0 else {
                respondError("button: remote down returned \(rcDown)")
                return
            }
            Thread.sleep(forTimeInterval: 0.04)
            let rcUp = udid.withCString {
                scIndigoHIDUsage($0, hidConsumerPage, usage, 2)
            }
            guard rcUp == 0 else {
                respondError("button: remote up returned \(rcUp)")
                return
            }
            respond(ok: true)
            return
        }

        // iOS hardware buttons (Home, …) go through the real button HID path.
        if let btnCode = iosHardwareButtonKeyCode(buttonName) {
            let rcDown = udid.withCString {
                scIndigoButton($0, btnCode, 1, iosButtonTarget)
            }
            guard rcDown == 0 else {
                respondError("button: hw down returned \(rcDown)")
                return
            }
            Thread.sleep(forTimeInterval: 0.05)
            let rcUp = udid.withCString {
                scIndigoButton($0, btnCode, 2, iosButtonTarget)
            }
            guard rcUp == 0 else {
                respondError("button: hw up returned \(rcUp)")
                return
            }
            respond(ok: true)
            return
        }

        guard let mapping = buttonToKey(buttonName) else {
            respondError("button: unknown button '\(buttonName)'")
            return
        }

        // Send key-down
        let rcDown = udid.withCString { udidPtr in
            scIndigoKeyboard(udidPtr, mapping.keycode, mapping.flags, true)
        }
        guard rcDown == 0 else {
            respondError("button: key-down returned \(rcDown)")
            return
        }

        // 15ms pause between down and up — mirrors keyboard.rs
        Thread.sleep(forTimeInterval: 0.015)

        // Send key-up
        let rcUp = udid.withCString { udidPtr in
            scIndigoKeyboard(udidPtr, mapping.keycode, mapping.flags, false)
        }
        guard rcUp == 0 else {
            respondError("button: key-up returned \(rcUp)")
            return
        }

        respond(ok: true)

    // ------------------------------------------------------------------
    // hw_button — send a hardware button via IndigoHIDMessageForButton.
    // Parametric (keyCode/op/target) for empirical probing; sends a down+up
    // pair when op is omitted.
    // ------------------------------------------------------------------
    case "hw_button":
        guard let udid = obj["udid"] as? String,
              let keyCode = obj["keyCode"] as? Int else {
            respondError("hw_button: missing required field(s)")
            return
        }
        let target = UInt32(obj["target"] as? Int ?? Int(iosButtonTarget))
        if let op = obj["op"] as? Int {
            let rc = udid.withCString {
                scIndigoButton($0, UInt32(keyCode), UInt32(op), target)
            }
            respond(ok: rc == 0, extras: ["rc": Int(rc)])
        } else {
            let rcDown = udid.withCString {
                scIndigoButton($0, UInt32(keyCode), 1, target)
            }
            Thread.sleep(forTimeInterval: 0.05)
            let rcUp = udid.withCString {
                scIndigoButton($0, UInt32(keyCode), 2, target)
            }
            respond(ok: rcDown == 0 && rcUp == 0,
                    extras: ["rcDown": Int(rcDown), "rcUp": Int(rcUp)])
        }

    // ------------------------------------------------------------------
    // keyboard — send a raw key event (down or up) via Indigo HID
    // ------------------------------------------------------------------
    case "keyboard":
        guard let udid = obj["udid"] as? String,
              let keyCode = obj["keyCode"] as? Int,
              let modifierFlags = obj["modifierFlags"] as? UInt64,
              let isDown = obj["isDown"] as? Bool else {
            respondError("keyboard: missing required field(s)")
            return
        }

        let rc = udid.withCString { udidPtr in
            scIndigoKeyboard(udidPtr, UInt16(keyCode), modifierFlags, isDown)
        }
        if rc != 0 {
            respondError("keyboard: sc_indigo_keyboard returned \(rc)")
            return
        }
        respond(ok: true)

    default:
        respondError("unknown command '\(cmd)'")
    }
}

// ---------------------------------------------------------------------------
// MARK: - Main loop
// ---------------------------------------------------------------------------

// Read stdin line by line — blocking read, no run-loop needed.
while let line = readLine(strippingNewline: true) {
    let trimmed = line.trimmingCharacters(in: .whitespaces)
    guard !trimmed.isEmpty else { continue }

    guard let data = trimmed.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        respondError("invalid JSON")
        continue
    }

    dispatch(obj)
}
