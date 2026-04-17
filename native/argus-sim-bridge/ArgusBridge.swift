import Foundation
import CoreGraphics
import AppKit

// MARK: - Frame callback type
typealias FrameCallback = @convention(c) (UnsafePointer<UInt8>, UInt) -> Void

// MARK: - IOSurface Framebuffer Capture (via ObjC — see ArgusHID.m)

// ObjC functions that handle SimDeviceIOClient and IOSurface via XPC proxies.
// Must be in ObjC because the IO port objects are ROCKRemoteProxy instances
// that require block-based callbacks (not KVC) for IOSurface transfer.
@_silgen_name("SHStartFramebuffer")
func SHStartFramebuffer(_ device: AnyObject, _ callback: FrameCallback) -> Int32

@_silgen_name("SHStopFramebuffer")
func SHStopFramebuffer()

/// Start capturing the simulator framebuffer via CoreSimulator's IOSurface.
/// Calls `callback` with JPEG bytes at ~30fps.
/// Returns 0 on success, non-zero on failure.
@_cdecl("cs_start_framebuffer")
func csStartFramebuffer(_ udid: UnsafePointer<CChar>, _ callback: @escaping FrameCallback) -> Int32 {
    let udidStr = String(cString: udid)

    // Also load SimulatorKit (needed for SimDeviceIOClient)
    ensureSimKitLoaded()

    guard let device = findSimDevice(udid: udidStr) else {
        NSLog("[Framebuffer] No SimDevice for UDID %@", udidStr)
        return -1
    }

    return SHStartFramebuffer(device, callback)
}

/// Stop the active framebuffer capture.
@_cdecl("cs_stop_framebuffer")
func csStopFramebuffer() {
    SHStopFramebuffer()
}

// MARK: - Indigo HID Touch Injection

// Lazy-initialized Indigo state (accessed on main thread via Tauri IPC)
private var indigoFnPtr: UnsafeMutableRawPointer?    // raw ptr to IndigoHIDMessageForMouseNSEvent
private var indigoLoaded = false
private var indigoKeyboardFnPtr: UnsafeMutableRawPointer?  // raw ptr to IndigoHIDMessageForKeyboardNSEvent
private var indigoKeyboardLoaded = false

// Per-UDID HID clients — allows simultaneous connections to multiple simulators.
private var hidClients: [String: AnyObject] = [:]

// External ObjC function that calls IndigoHIDMessageForMouseNSEvent with correct
// SIMD register setup and sends via the HID client. Defined in ArgusHID.m.
@_silgen_name("SHSendTouch")
func SHSendTouch(_ client: AnyObject, _ fnPtr: UnsafeMutableRawPointer,
                  _ udid: UnsafePointer<CChar>,
                  _ normX: Float, _ normY: Float,
                  _ nsEventType: Int32, _ direction: Int32) -> Int32

@_silgen_name("SHSendKeyboard")
func SHSendKeyboard(_ client: AnyObject, _ fnPtr: UnsafeMutableRawPointer,
                     _ udid: UnsafePointer<CChar>,
                     _ keyCode: UInt16, _ modifierFlags: UInt64,
                     _ isDown: Bool) -> Int32

@_silgen_name("SHIsHIDClientInvalidForUDID")
func SHIsHIDClientInvalidForUDID(_ udid: UnsafePointer<CChar>) -> Bool

@_silgen_name("SHResetHIDClientInvalidForUDID")
func SHResetHIDClientInvalidForUDID(_ udid: UnsafePointer<CChar>)

@_silgen_name("SHClearTouchStateForUDID")
func SHClearTouchStateForUDID(_ udid: UnsafePointer<CChar>)

private func xcodeDevDir() -> String {
    let pipe = Pipe()
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/usr/bin/xcode-select")
    proc.arguments = ["-p"]
    proc.standardOutput = pipe
    try? proc.run()
    proc.waitUntilExit()
    return String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
        .trimmingCharacters(in: .whitespacesAndNewlines)
        ?? "/Applications/Xcode.app/Contents/Developer"
}

// MARK: - Framework loading

private var coreSimLoaded = false
private var coreSimOk = false
private var simKitLoaded = false
private var simKitOk = false

/// Ensure CoreSimulator.framework is loaded (required before using SimServiceContext).
@discardableResult
private func ensureCoreSimLoaded() -> Bool {
    if coreSimLoaded { return coreSimOk }
    coreSimLoaded = true

    let coreSimPath = "/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator"
    guard dlopen(coreSimPath, RTLD_NOW | RTLD_GLOBAL) != nil else {
        NSLog("[CoreSim] Failed to load CoreSimulator from %@", coreSimPath)
        coreSimOk = false
        return false
    }
    NSLog("[CoreSim] Loaded CoreSimulator")
    coreSimOk = true
    return true
}

/// Ensure SimulatorKit.framework is loaded (required for SimDeviceIOClient, IndigoHID).
@discardableResult
private func ensureSimKitLoaded() -> Bool {
    if simKitLoaded { return simKitOk }
    simKitLoaded = true

    ensureCoreSimLoaded()

    let devDir = xcodeDevDir()
    let simKitPath = devDir + "/Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit"
    guard dlopen(simKitPath, RTLD_NOW | RTLD_GLOBAL) != nil else {
        NSLog("[SimKit] Failed to load SimulatorKit from %@", simKitPath)
        simKitOk = false
        return false
    }
    NSLog("[SimKit] Loaded SimulatorKit")
    simKitOk = true
    return true
}

private func ensureIndigoLoaded() -> Bool {
    if indigoLoaded { return indigoFnPtr != nil }
    indigoLoaded = true

    guard ensureSimKitLoaded() else { return false }

    let devDir = xcodeDevDir()
    let simKitPath = devDir + "/Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit"

    guard let simKitHandle = dlopen(simKitPath, RTLD_NOW | RTLD_GLOBAL) else {
        NSLog("[IndigoHID] Failed to load SimulatorKit from %@", simKitPath)
        return false
    }

    guard let sym = dlsym(simKitHandle, "IndigoHIDMessageForMouseNSEvent") else {
        NSLog("[IndigoHID] IndigoHIDMessageForMouseNSEvent symbol not found")
        return false
    }
    NSLog("[IndigoHID] IndigoHIDMessageForMouseNSEvent loaded")
    indigoFnPtr = sym
    return true
}

private func ensureIndigoKeyboardLoaded() -> Bool {
    if indigoKeyboardLoaded { return indigoKeyboardFnPtr != nil }
    indigoKeyboardLoaded = true

    guard ensureSimKitLoaded() else { return false }

    let devDir = xcodeDevDir()
    let simKitPath = devDir + "/Library/PrivateFrameworks/SimulatorKit.framework/SimulatorKit"

    guard let simKitHandle = dlopen(simKitPath, RTLD_NOW | RTLD_GLOBAL) else {
        NSLog("[IndigoHID] Failed to load SimulatorKit for keyboard")
        return false
    }

    guard let sym = dlsym(simKitHandle, "IndigoHIDMessageForKeyboardNSEvent") else {
        NSLog("[IndigoHID] IndigoHIDMessageForKeyboardNSEvent symbol not found")
        return false
    }
    NSLog("[IndigoHID] IndigoHIDMessageForKeyboardNSEvent loaded")
    indigoKeyboardFnPtr = sym
    return true
}

func findSimDevice(udid: String) -> AnyObject? {
    guard ensureCoreSimLoaded() else { return nil }

    let devDir = xcodeDevDir()

    guard let contextClass = NSClassFromString("SimServiceContext") else {
        NSLog("[IndigoHID] SimServiceContext class not found")
        return nil
    }

    let contextSel = NSSelectorFromString("sharedServiceContextForDeveloperDir:error:")
    guard let context = (contextClass as AnyObject)
        .perform(contextSel, with: devDir as NSString, with: nil)?
        .takeUnretainedValue() else {
        NSLog("[IndigoHID] Failed to get SimServiceContext")
        return nil
    }

    let setSel = NSSelectorFromString("defaultDeviceSetWithError:")
    guard let deviceSet = context.perform(setSel, with: nil)?.takeUnretainedValue() else {
        NSLog("[IndigoHID] Failed to get default device set")
        return nil
    }

    guard let devices = deviceSet.value(forKey: "devices") as? [AnyObject] else {
        NSLog("[IndigoHID] Failed to read devices array")
        return nil
    }

    let target = udid.uppercased()
    for device in devices {
        if let deviceUDID = device.value(forKey: "UDID") as? NSUUID,
           deviceUDID.uuidString.uppercased() == target {
            return device
        }
    }

    NSLog("[IndigoHID] No SimDevice for UDID %@", udid)
    return nil
}

/// Create (or reuse) a SimDeviceLegacyHIDClient for the given UDID.
private func ensureHIDClient(udid: String) -> Bool {
    if hidClients[udid] != nil { return true }

    guard let device = findSimDevice(udid: udid) else {
        NSLog("[IndigoHID] findSimDevice returned nil for %@", udid)
        return false
    }

    let clientClass: AnyClass? =
        NSClassFromString("SimulatorKit.SimDeviceLegacyHIDClient")
        ?? NSClassFromString("SimDeviceLegacyHIDClient")
    guard let cls = clientClass else {
        NSLog("[IndigoHID] SimDeviceLegacyHIDClient class not found")
        return false
    }

    guard let allocated = (cls as AnyObject)
        .perform(NSSelectorFromString("alloc"))?
        .takeUnretainedValue() else {
        NSLog("[IndigoHID] Failed to alloc HID client")
        return false
    }
    guard let client = allocated
        .perform(NSSelectorFromString("initWithDevice:error:"), with: device, with: nil)?
        .takeRetainedValue() else {
        NSLog("[IndigoHID] initWithDevice:error: returned nil")
        return false
    }

    hidClients[udid] = client
    NSLog("[IndigoHID] HID client ready for %@", udid)
    return true
}

/// Inject a touch event into the simulator via the Indigo HID protocol.
///
/// `norm_x`, `norm_y`: normalized screen coordinates in [0.0, 1.0].
/// `event_type`: 0 = Down, 1 = Drag, 2 = Up.
/// Returns 0 on success, negative on failure.
@_cdecl("sc_indigo_touch")
func scIndigoTouch(_ udid: UnsafePointer<CChar>,
                    _ normX: Float, _ normY: Float,
                    _ eventType: Int32) -> Int32 {
    let udidStr = String(cString: udid)

    guard ensureIndigoLoaded() else {
        NSLog("[IndigoHID] ensureIndigoLoaded failed")
        return -1
    }

    // If the ObjC layer detected a mach port invalidation for THIS simulator,
    // the touch sequence is broken. Reject DRAG/UP — only DOWN can start fresh.
    if SHIsHIDClientInvalidForUDID(udid) {
        hidClients.removeValue(forKey: udidStr)
        if eventType == 1 || eventType == 2 {
            SHClearTouchStateForUDID(udid)
            NSLog("[IndigoHID] HID client invalidated — rejecting %@ (need fresh DOWN)",
                  eventType == 1 ? "DRAG" : "UP")
            return -5  // sequence broken, frontend will set touchFailed
        }
        SHResetHIDClientInvalidForUDID(udid)
    }

    guard ensureHIDClient(udid: udidStr) else {
        NSLog("[IndigoHID] ensureHIDClient failed for %@", udidStr)
        return -2
    }
    guard let fnPtr = indigoFnPtr, let client = hidClients[udidStr] else {
        return -3
    }

    // Map our event types to NSEvent type raw values + direction:
    //   Down → NSEventTypeLeftMouseDown (1), direction=1
    //   Drag → NSEventTypeLeftMouseDragged (6), direction=0
    //   Up   → NSEventTypeLeftMouseUp (2), direction=2
    let nsEventType: Int32
    let direction: Int32
    switch eventType {
    case 0:  nsEventType = 1; direction = 1  // mouseDown, down
    case 1:  nsEventType = 6; direction = 0  // mouseDragged, neutral
    case 2:  nsEventType = 2; direction = 2  // mouseUp, up
    default: return -4
    }

    // IndigoHIDMessageForMouseNSEvent uses thread-local state — MUST run on main thread.
    let sendTouch = { (c: AnyObject) -> Int32 in
        if Thread.isMainThread {
            return SHSendTouch(c, fnPtr, udid, normX, normY, nsEventType, direction)
        } else {
            return DispatchQueue.main.sync {
                SHSendTouch(c, fnPtr, udid, normX, normY, nsEventType, direction)
            }
        }
    }

    var rc = sendTouch(client)

    // -6 means DOWN's synchronous send detected machPortInvalid.
    // Recreate the client and retry once — the mach port was likely stale
    // because the client was created before activate_simulator_window took effect.
    if rc == -6 && eventType == 0 {
        NSLog("[IndigoHID] DOWN failed with stale mach port — recreating client for %@", udidStr)
        hidClients.removeValue(forKey: udidStr)
        SHResetHIDClientInvalidForUDID(udid)
        SHClearTouchStateForUDID(udid)
        guard ensureHIDClient(udid: udidStr), let retryClient = hidClients[udidStr] else {
            return -2
        }
        rc = sendTouch(retryClient)
    }

    if rc != 0 && rc != -2 {
        // Non-sequence error (e.g. send failure) — force client recreation.
        // -2 means IndigoHIDMessageForMouseNSEvent returned NULL (broken touch
        // sequence), which doesn't indicate a bad client — just wait for next DOWN.
        hidClients.removeValue(forKey: udidStr)
    }
    return rc
}

/// Inject a keyboard event into the simulator via the Indigo HID protocol.
///
/// keyCode: macOS virtual key code (e.g. 126=Up, 36=Return).
/// modifierFlags: NSEvent modifier flags (e.g. NSEventModifierFlagCommand).
/// isDown: true for key-down, false for key-up.
/// Returns 0 on success, negative on failure.
@_cdecl("sc_indigo_keyboard")
func scIndigoKeyboard(_ udid: UnsafePointer<CChar>,
                       _ keyCode: UInt16,
                       _ modifierFlags: UInt64,
                       _ isDown: Bool) -> Int32 {
    let udidStr = String(cString: udid)

    guard ensureIndigoKeyboardLoaded() else {
        NSLog("[IndigoHID] ensureIndigoKeyboardLoaded failed")
        return -1
    }

    // Check for mach port invalidation on this simulator's client.
    if SHIsHIDClientInvalidForUDID(udid) {
        hidClients.removeValue(forKey: udidStr)
        SHResetHIDClientInvalidForUDID(udid)
    }

    guard ensureHIDClient(udid: udidStr) else {
        NSLog("[IndigoHID] ensureHIDClient failed for %@", udidStr)
        return -2
    }
    guard let fnPtr = indigoKeyboardFnPtr, let client = hidClients[udidStr] else {
        return -3
    }

    // IndigoHIDMessageForKeyboardNSEvent may use thread-local state — run on main thread.
    let rc: Int32
    if Thread.isMainThread {
        rc = SHSendKeyboard(client, fnPtr, udid, keyCode, modifierFlags, isDown)
    } else {
        rc = DispatchQueue.main.sync {
            SHSendKeyboard(client, fnPtr, udid, keyCode, modifierFlags, isDown)
        }
    }
    if rc != 0 {
        hidClients.removeValue(forKey: udidStr)
    }
    return rc
}
