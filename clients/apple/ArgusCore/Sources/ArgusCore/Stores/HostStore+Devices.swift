import ArgusKit
import Foundation

/// Mirrored devices: watching, input injection and who holds each one.
extension HostStore {

  // MARK: Devices

  public func watchDevice(deviceId: String, platform: RemotePlatform) async -> UInt16? {
    guard let backend else { return nil }
    struct Params: Encodable {
      let device_id: String
      let platform: String
    }
    struct Result: Decodable { let stream_id: Int }
    let result = try? await backend.request(
      .devicesWatch, Params(device_id: deviceId, platform: platform.rawValue), as: Result.self)
    return result.map { UInt16(truncatingIfNeeded: $0.stream_id) }
  }

  public func unwatchDevice(deviceId: String) async {
    guard let backend else { return }
    struct Params: Encodable { let device_id: String }
    _ = try? await backend.request(
      .devicesUnwatch, Params(device_id: deviceId), as: IgnoredResult.self)
  }

  /// The session's embedded browser as JPEG media frames.
  public func watchBrowser(sessionId: String) async -> UInt16? {
    guard let backend else { return nil }
    struct Params: Encodable { let session_id: String }
    struct Result: Decodable { let stream_id: Int }
    let result = try? await backend.request(
      .browserWatch, Params(session_id: sessionId), as: Result.self)
    return result.map { UInt16(truncatingIfNeeded: $0.stream_id) }
  }

  public func unwatchBrowser(sessionId: String) async {
    guard let backend else { return }
    struct Params: Encodable { let session_id: String }
    _ = try? await backend.request(
      .browserUnwatch, Params(session_id: sessionId), as: IgnoredResult.self)
  }

  /// How the device is being held, recorded in `deviceStates`. Null on
  /// Android, which rotates its own framebuffer and has no hinge to report.
  @discardableResult
  public func deviceState(deviceId: String, platform: RemotePlatform) async -> RemoteDeviceState? {
    guard let backend else { return nil }
    struct Params: Encodable {
      let device_id: String
      let platform: String
    }
    struct Result: Decodable { let state: RemoteDeviceState? }
    let result = try? await backend.request(
      .devicesState, Params(device_id: deviceId, platform: platform.rawValue), as: Result.self)
    if let state = result?.state { deviceStates[deviceId] = state }
    return result?.state
  }

  @discardableResult
  public func setDeviceOrientation(
    deviceId: String, platform: RemotePlatform, orientation: RemoteDeviceOrientation
  ) async -> RemoteDeviceState? {
    guard let backend else { return nil }
    struct Params: Encodable {
      let device_id: String
      let platform: String
      let orientation: String
    }
    struct Result: Decodable { let state: RemoteDeviceState? }
    let result = try? await backend.request(
      .devicesSetOrientation,
      Params(
        device_id: deviceId, platform: platform.rawValue, orientation: orientation.rawValue),
      as: Result.self)
    return result?.state
  }

  @discardableResult
  public func setDeviceFold(
    deviceId: String, platform: RemotePlatform, pose: RemoteFoldPose
  ) async -> RemoteDeviceState? {
    guard let backend else { return nil }
    struct Params: Encodable {
      let device_id: String
      let platform: String
      let pose: String
    }
    struct Result: Decodable { let state: RemoteDeviceState? }
    let result = try? await backend.request(
      .devicesSetFold,
      Params(device_id: deviceId, platform: platform.rawValue, pose: pose.rawValue),
      as: Result.self)
    return result?.state
  }

  /// Fire-and-forget: a touch that waits for a round trip feels broken.
  public func deviceTouch(
    deviceId: String, platform: RemotePlatform, x: Double, y: Double, eventType: Int
  ) {
    guard let backend else { return }
    struct Params: Encodable {
      let device_id: String
      let platform: String
      let x: Double
      let y: Double
      let event_type: Int
    }
    Task {
      try? await backend.request(
        .devicesTouch,
        Params(
          device_id: deviceId, platform: platform.rawValue,
          x: min(max(x, 0), 0.9999), y: min(max(y, 0), 0.9999), event_type: eventType),
        as: IgnoredResult.self)
    }
  }

  // MARK: Device claims
  //
  // Two clients may watch one screen; both injecting touches into it is
  // nonsense, so the host arbitrates. Taking the claim up front means the
  // phone can say who is driving instead of silently dropping taps.

  /// Take the device. `force` steals it from whoever holds it.
  @discardableResult
  public func claimDevice(deviceId: String, force: Bool = false) async -> Bool {
    guard let backend else { return false }
    struct Params: Encodable {
      let device_id: String
      let force: Bool
    }
    struct Result: Decodable {
      let granted: Bool
      let holder: RemoteDeviceClaim?
    }
    guard let result = try? await backend.request(
      .devicesClaim, Params(device_id: deviceId, force: force), as: Result.self)
    else { return false }
    deviceClaims[deviceId] = RemoteDeviceClaimState(
      deviceId: deviceId, holder: result.holder, waiting: [])

    return result.granted
  }

  public func releaseDevice(deviceId: String) async {
    guard let backend else { return }
    struct Params: Encodable { let device_id: String }
    _ = try? await backend.request(
      .devicesRelease, Params(device_id: deviceId), as: IgnoredResult.self)
    deviceClaims.removeValue(forKey: deviceId)
  }

  /// Who holds the device — and, as a side effect, this connection's own id,
  /// which the host reports nowhere else.
  public func loadClaimStatus(deviceId: String) async {
    guard let backend else { return }
    struct Params: Encodable { let device_id: String }
    struct Result: Decodable {
      let holder: RemoteDeviceClaim?
      let connection_id: String
    }
    guard let result = try? await backend.request(
      .devicesClaimStatus, Params(device_id: deviceId), as: Result.self) else { return }
    connectionId = result.connection_id
    deviceClaims[deviceId] = RemoteDeviceClaimState(
      deviceId: deviceId, holder: result.holder, waiting: [])
  }

  public func deviceButton(deviceId: String, platform: RemotePlatform, button: String) {
    guard let backend else { return }
    struct Params: Encodable {
      let device_id: String
      let platform: String
      let button: String
    }
    Task {
      try? await backend.request(
        .devicesButton,
        Params(device_id: deviceId, platform: platform.rawValue, button: button),
        as: IgnoredResult.self)
    }
  }

  public func deviceKeyboard(
    deviceId: String, platform: RemotePlatform, keyCode: Int, modifiers: Int, isDown: Bool
  ) {
    guard let backend else { return }
    struct Params: Encodable {
      let device_id: String
      let platform: String
      let key_code: Int
      let modifiers: Int
      let is_down: Bool
    }
    Task {
      try? await backend.request(
        .devicesKeyboard,
        Params(
          device_id: deviceId, platform: platform.rawValue, key_code: keyCode,
          modifiers: modifiers, is_down: isDown),
        as: IgnoredResult.self)
    }
  }
}
