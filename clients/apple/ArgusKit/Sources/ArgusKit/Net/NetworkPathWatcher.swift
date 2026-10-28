import Foundation
import Network

/// Announces when the device's network path changes: Wi-Fi joined or left, a
/// VPN (Tailscale) came up, cellular took over. The first report is the
/// starting point, not a change, so it isn't announced.
public final class NetworkPathWatcher: Sendable {
  private let monitor = NWPathMonitor()
  private let queue = DispatchQueue(label: "argus.network-path")

  public init() {}

  /// Calls `onChange` (on the monitor's queue) each time the path moves.
  public func start(_ onChange: @escaping @Sendable () -> Void) {
    let last = LastSignature()
    monitor.pathUpdateHandler = { path in
      if last.swap(Self.signature(path)) { onChange() }
    }
    monitor.start(queue: queue)
  }

  public func stop() {
    monitor.cancel()
  }

  /// What distinguishes one network from the next, for change detection.
  private static func signature(_ path: NWPath) -> String {
    let interfaces = path.availableInterfaces.map { "\($0.name):\($0.type)" }.joined(separator: ",")
    return "\(path.status)|\(interfaces)"
  }
}

/// The previous path's signature; touched only on the monitor's serial queue.
private final class LastSignature: @unchecked Sendable {
  private var value: String?

  /// Store `next`; true when it differs from a previous one.
  func swap(_ next: String) -> Bool {
    defer { value = next }
    return value != nil && value != next
  }
}
