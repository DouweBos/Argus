import Foundation

/// How a remote-access row reads: green, red or neutral.
public enum RemoteTone: Sendable, Equatable {
  case success
  case idle
  case error
}

/// The wording of the Remote Access settings, shared so every client says the
/// same thing as the desktop's `RemoteAccessSection`.
public enum RemoteAccessLabels {
  public static func endpoint(_ kind: ArgusProtocol.RemoteEndpointKind) -> String {
    switch kind {
    case .lan: "Local network"
    case .tailscale: "Tailscale"
    case .cloudflare: "Cloudflare"
    default: kind.rawValue
    }
  }

  public static func tunnelTone(_ state: ArgusProtocol.RemoteTunnelState?) -> RemoteTone {
    guard let state else { return .idle }
    if state.status == .error || state.reachable == false { return .error }
    return state.status == .running ? .success : .idle
  }

  /// A published URL that nothing answers on is worse than no URL — say so.
  public static func tunnelLabel(_ state: ArgusProtocol.RemoteTunnelState?) -> String {
    guard let state else { return "stopped" }
    if state.reachable == false { return "unreachable" }
    return state.publicUrl ?? state.status.rawValue
  }

  /// Green once any address is live, red only when every enabled way in failed.
  public static func reachabilityTone(_ status: ArgusProtocol.RemoteStatus) -> RemoteTone {
    if !status.endpoints.isEmpty { return .success }
    return status.tunnels.values.contains { $0.status == .error } ? .error : .idle
  }

  public static func reachabilityLabel(_ status: ArgusProtocol.RemoteStatus) -> String {
    let count = status.endpoints.count
    if count > 0 { return count == 1 ? "1 way in" : "\(count) ways in" }
    return reachabilityTone(status) == .error ? "unreachable" : "starting"
  }

  /// The addresses in the order a phone tries them.
  public static func orderedEndpoints(_ status: ArgusProtocol.RemoteStatus) -> [ArgusProtocol.RemoteEndpoint] {
    status.endpoints.sorted { $0.priority < $1.priority }
  }

  /// The LAN gateway as the web client's address.
  public static func webClientUrl(_ lanUrl: String?) -> String {
    guard let lanUrl else { return "no LAN address" }
    return lanUrl.hasPrefix("ws:") ? "http:" + lanUrl.dropFirst(3) : lanUrl
  }

  public static func lastSeen(_ ms: Double?, now: Date = Date()) -> String {
    guard let ms, ms > 0 else { return "never connected" }
    let mins = Int((now.timeIntervalSince1970 * 1000 - ms) / 60_000)
    if mins < 1 { return "just now" }
    if mins < 60 { return "\(mins)m ago" }
    let hrs = mins / 60
    return hrs < 24 ? "\(hrs)h ago" : "\(hrs / 24)d ago"
  }

  public static func grants(_ capabilities: [ArgusProtocol.PairedDeviceCapabilitiesItem]) -> String {
    if capabilities.contains(.admin) { return "full control (admin)" }
    return capabilities.contains(.control) ? "monitor + control" : "monitor only"
  }

  public static func push(_ service: ArgusProtocol.DevicePushTokenService) -> String {
    switch service {
    case .apns: "Apple"
    case .fcm: "Firebase"
    case .webpush: "Web Push"
    default: service.rawValue
    }
  }

  /// What a paired device is, from the push channel it registered — the
  /// trust store keeps no client kind of its own.
  public static func clientKind(_ device: ArgusProtocol.PairedDevice) -> String? {
    switch device.push?.service {
    case .apns?, .fcm?: "phone"
    case .webpush?: "browser"
    default: nil
    }
  }
}
