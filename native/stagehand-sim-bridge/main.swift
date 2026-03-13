// main.swift — JSON-over-stdio entry point for the stagehand-sim-bridge binary.
//
// Reads newline-delimited JSON commands from stdin, dispatches them to the
// Swift/ObjC simulation layer (StagehandBridge.swift + StagehandHID.m), and
// writes JSON responses back to stdout.
//
// Protocol:
//   {"cmd":"start_capture","udid":"..."}              → {"ok":true,"port":12345}
//   {"cmd":"stop_capture"}                            → {"ok":true}
//   {"cmd":"touch","udid":"...","x":0.5,"y":0.5,"type":0}  → {"ok":true}
//   {"cmd":"button","udid":"...","button":"home"}          → {"ok":true}
//   {"cmd":"keyboard","udid":"...","keyCode":36,
//           "modifierFlags":0,"isDown":true}               → {"ok":true}
//
// One response is written per command, flush is forced after each write so
// the parent process receives the response without buffering delays.

import Foundation

// ---------------------------------------------------------------------------
// MARK: - Bridge functions
// ---------------------------------------------------------------------------

// csStartFramebuffer, csStopFramebuffer, scIndigoTouch, scIndigoKeyboard
// are defined in StagehandBridge.swift (compiled in the same module) and
// callable directly — no forward declarations needed.

// ---------------------------------------------------------------------------
// MARK: - MJPEG TCP server
// ---------------------------------------------------------------------------

// Shared frame state — updated by the capture callback, consumed by the
// MJPEG streaming thread.
private final class FrameState {
    var data: Data = Data()
    var seq: UInt64 = 0
    let lock = NSLock()
    let cond = NSCondition()
}

private let frameState = FrameState()

/// C-callable frame callback invoked by cs_start_framebuffer at ~30fps.
private let frameCallback: @convention(c) (UnsafePointer<UInt8>, UInt) -> Void = {
    ptr, len in
    let bytes = Data(bytes: ptr, count: Int(len))
    frameState.cond.lock()
    frameState.data = bytes
    frameState.seq &+= 1
    frameState.cond.broadcast()
    frameState.cond.unlock()
}

/// Serve an MJPEG stream to a single connected TCP client.
private func serveMjpegClient(_ fd: Int32) {
    // Send HTTP response headers
    let header =
        "HTTP/1.1 200 OK\r\n" +
        "Content-Type: multipart/x-mixed-replace; boundary=frame\r\n" +
        "Cache-Control: no-cache, no-store\r\n" +
        "Connection: close\r\n" +
        "Access-Control-Allow-Origin: *\r\n" +
        "\r\n"

    guard writeAll(fd, header.data(using: .utf8)!) else {
        close(fd)
        return
    }

    var lastSeq: UInt64 = 0

    while true {
        // Wait for a new frame
        frameState.cond.lock()
        while frameState.seq == lastSeq {
            frameState.cond.wait()
        }
        lastSeq = frameState.seq
        let frame = frameState.data
        frameState.cond.unlock()

        if frame.isEmpty { continue }

        let part =
            "--frame\r\n" +
            "Content-Type: image/jpeg\r\n" +
            "Content-Length: \(frame.count)\r\n" +
            "\r\n"

        guard writeAll(fd, part.data(using: .utf8)!) else { break }
        guard writeAll(fd, frame) else { break }
        guard writeAll(fd, "\r\n".data(using: .utf8)!) else { break }
    }

    close(fd)
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

/// Bind a TCP listener on a random port, start accepting MJPEG clients in
/// background threads, and return the bound port number.
private func startMjpegServer() throws -> UInt16 {
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
    addr.sin_addr.s_addr = INADDR_ANY

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

    // Accept clients in a background thread
    Thread.detachNewThread {
        while true {
            let clientFd = accept(serverFd, nil, nil)
            guard clientFd >= 0 else { break }
            let capturedFd = clientFd
            Thread.detachNewThread {
                serveMjpegClient(capturedFd)
            }
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
    // iOS home: Cmd+Shift+H
    case "ios_home":  return KeyMapping(keycode: 4,   flags: 0x120000)
    default:          return nil
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
    // start_capture — start IOSurface framebuffer capture + MJPEG server
    // ------------------------------------------------------------------
    case "start_capture":
        guard let udid = obj["udid"] as? String else {
            respondError("start_capture: missing 'udid'")
            return
        }

        // Start the MJPEG TCP server first so we have a port to report
        let port: UInt16
        do {
            port = try startMjpegServer()
        } catch {
            respondError("start_capture: failed to start MJPEG server: \(error)")
            return
        }

        // Call cs_start_framebuffer (StagehandBridge.swift)
        let rc = udid.withCString { udidPtr in
            csStartFramebuffer(udidPtr, frameCallback)
        }
        guard rc == 0 else {
            respondError("start_capture: cs_start_framebuffer returned \(rc)")
            return
        }

        respond(ok: true, extras: ["port": port])

    // ------------------------------------------------------------------
    // stop_capture — stop IOSurface framebuffer capture
    // ------------------------------------------------------------------
    case "stop_capture":
        csStopFramebuffer()
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
