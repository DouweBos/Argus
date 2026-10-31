import ArgusKit
import CoreGraphics
import Foundation
import Observation

/// What `DeviceSession` needs from a host. `HostStore` answers it over
/// whichever backend it has; tests answer it in memory.
@MainActor
public protocol DeviceSessionHost: AnyObject {
  var connectionId: String? { get }
  var deviceClaims: [String: RemoteDeviceClaimState] { get }
  func loadClaimStatus(deviceId: String) async
  @discardableResult func claimDevice(deviceId: String, force: Bool) async -> Bool
  @discardableResult
  func deviceState(deviceId: String, platform: RemotePlatform) async -> RemoteDeviceState?
}

extension HostStore: DeviceSessionHost {}

/// One screen watching one live device: open the stream (retrying while the
/// device finishes booting), take the claim, seed its pose, and give up on a
/// picture that never arrives. Shared by the Mac panel and the phone.
@MainActor
@Observable
public final class DeviceSession {
  public enum Status: Equatable, Sendable { case connecting, error, noVideo, streaming }

  public struct Timing: Sendable {
    /// A device that only just booted refuses capture for a while.
    public var startAttempts = 6
    public var retryDelay = Duration.seconds(5)
    /// Booted but producing nothing decodable — worth saying so.
    public var noVideoTimeout = Duration.seconds(10)

    public init() {}
  }

  /// One finished look at a device, for telemetry.
  public struct Watch: Equatable, Sendable {
    public var platform: RemotePlatform
    public var durationMs: Int
    public var interacted: Bool
  }

  public typealias Attach =
    @MainActor (_ sink: @escaping @MainActor (MediaMessage) -> Void) async -> (() -> Void)?

  public private(set) var status = Status.connecting
  /// The stream's own size, zero until its config arrives.
  public private(set) var codedSize = CGSize.zero

  @ObservationIgnored private let timing: Timing
  @ObservationIgnored private let sleep: @Sendable (Duration) async -> Void
  @ObservationIgnored private let now: @Sendable () -> Date
  @ObservationIgnored private let onWatchEnded: @MainActor (Watch) -> Void
  @ObservationIgnored private var detach: (() -> Void)?
  @ObservationIgnored private var watch: (deviceId: String, platform: RemotePlatform, start: Date)?
  @ObservationIgnored private var interacted = false

  public init(
    timing: Timing = Timing(),
    sleep: @escaping @Sendable (Duration) async -> Void = { try? await Task.sleep(for: $0) },
    now: @escaping @Sendable () -> Date = Date.init,
    onWatchEnded: @escaping @MainActor (Watch) -> Void
  ) {
    self.timing = timing
    self.sleep = sleep
    self.now = now
    self.onWatchEnded = onWatchEnded
  }

  /// Who holds the device when it isn't this connection. Unknown until the
  /// host has told us our own id, and then nobody is assumed to be someone else.
  public static func otherHolder(
    _ claim: RemoteDeviceClaimState?, connectionId: String?
  ) -> RemoteDeviceClaim? {
    guard let holder = claim?.holder, let connectionId else { return nil }
    return holder.connectionId == connectionId ? nil : holder
  }

  /// Watch `deviceId` until the calling task is cancelled or `stop()`. A run on
  /// the same device continues its watch; another device ends it.
  public func run(
    deviceId: String,
    platform: RemotePlatform,
    host: some DeviceSessionHost,
    claim: Bool,
    attach: Attach,
    sink: @escaping @MainActor (MediaMessage) -> Void
  ) async {
    detachStream()
    if watch?.deviceId != deviceId {
      endWatch()
      watch = (deviceId, platform, now())
      interacted = false
    }
    status = .connecting
    codedSize = .zero

    let tracked: @MainActor (MediaMessage) -> Void = { [weak self] message in
      if case .config(_, _, let width, let height, _) = message {
        self?.codedSize = CGSize(width: width, height: height)
      }
      sink(message)
    }
    var attached: (() -> Void)?
    for attempt in 0..<timing.startAttempts {
      attached = await attach(tracked)
      if attached != nil || Task.isCancelled { break }
      if attempt + 1 < timing.startAttempts { await sleep(timing.retryDelay) }
    }
    guard let stop = attached else {
      if !Task.isCancelled { status = .error }
      return
    }
    // Superseded while starting: the next run owns the view now.
    guard !Task.isCancelled else { return stop() }
    detach = stop

    // Take the device unless someone else is already driving it; the host
    // pushes `device.claim` from here on.
    if claim {
      await host.loadClaimStatus(deviceId: deviceId)
      let claims = host.deviceClaims[deviceId]
      if Self.otherHolder(claims, connectionId: host.connectionId) == nil {
        await host.claimDevice(deviceId: deviceId, force: false)
      }
    }
    // Seed the pose; the host pushes `device.state` while it is watched.
    await host.deviceState(deviceId: deviceId, platform: platform)

    await sleep(timing.noVideoTimeout)
    if !Task.isCancelled, status == .connecting { status = .noVideo }
  }

  /// The first frame is on screen.
  public func markStreaming() {
    status = .streaming
  }

  /// Something was driven from this screen — a glance and a working session
  /// are worth telling apart.
  public func markInteracted() {
    interacted = true
  }

  /// Leave the device: drop the stream and report the watch.
  public func stop() {
    detachStream()
    endWatch()
  }

  private func detachStream() {
    detach?()
    detach = nil
  }

  private func endWatch() {
    guard let watch else { return }
    self.watch = nil
    let durationMs = Int(now().timeIntervalSince(watch.start) * 1000)
    onWatchEnded(Watch(platform: watch.platform, durationMs: durationMs, interacted: interacted))
  }
}
