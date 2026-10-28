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

  public static func managedTunnelTone(_ state: ArgusProtocol.ManagedTunnelState) -> RemoteTone {
    switch state.phase {
    case .running: .success
    case .error: .error
    default: .idle
    }
  }

  /// The account tunnel's state in a word or two; its address is shown apart.
  public static func managedTunnelLabel(_ state: ArgusProtocol.ManagedTunnelState) -> String {
    switch state.phase {
    case .running: "running"
    case .provisioning: "setting up"
    case .installing: "installing"
    case .starting: "starting"
    case .error: "error"
    case .unavailable: "unavailable"
    case .off: "off"
    default: state.phase.rawValue
    }
  }

  /// Why there is no tunnel, in plain words; nil while there is one.
  public static func managedTunnelNote(_ state: ArgusProtocol.ManagedTunnelState) -> String? {
    if state.phase == .unavailable { return "Your Argus account has no tunnels to give out right now." }
    guard state.phase == .off else { return nil }
    switch state.reason {
    case .notLinked?: return "Sign in to an Argus account to give this computer its own tunnel."
    case .accountPaused?: return "Tunnels are paused for your Argus account."
    case .turnedOff?: return "Turned off for this computer in its account settings."
    case .remoteOff?: return "Starts when remote access is on."
    default: return nil
    }
  }

  /// A tunnel an earlier version set up, by what it is.
  public static func legacyTunnel(_ kind: ArgusProtocol.LegacyTunnelKind) -> String {
    switch kind {
    case .cloudflareQuick: "Cloudflare quick tunnel"
    case .cloudflareToken: "Cloudflare named tunnel"
    case .tailscaleFunnel: "Tailscale Funnel"
    default: kind.rawValue
    }
  }

  public static func legacyTunnelTone(_ state: ArgusProtocol.LegacyTunnelState) -> RemoteTone {
    switch state.status {
    case .running: .success
    case .error: .error
    default: .idle
    }
  }

  public static func legacyTunnelLabel(_ state: ArgusProtocol.LegacyTunnelState) -> String {
    state.publicUrl ?? state.status.rawValue
  }

  /// Green once any address is live, red only when every way in failed.
  public static func reachabilityTone(_ status: ArgusProtocol.RemoteStatus) -> RemoteTone {
    if !status.endpoints.isEmpty { return .success }
    let failed = status.managedTunnel.phase == .error || status.legacyTunnels.contains { $0.status == .error }
    return failed ? .error : .idle
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
