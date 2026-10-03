import Foundation

/// One pairing: this device's key, the computer's pinned key, and how to reach it.
///
/// A phone can be paired with several computers; exactly one is connected at a
/// time. Each pairing is its own identity.
public struct DeviceIdentity: Codable, Hashable, Sendable, Identifiable {
  public var deviceId: String
  /// This device's static X25519 keypair, standard base64.
  public var devPrivB64: String
  public var devPubB64: String
  /// Pinned desktop static public key, standard base64.
  ///
  /// Note the pairing payload delivers this as base64**url**; it is re-encoded
  /// to standard base64 on the way in, so everything downstream sees one form.
  public var desktopPubB64: String
  /// Public URL of the gateway — the last known good address, and the only one
  /// a pairing made before endpoint sync has.
  public var url: String
  /// Every address this computer advertised, best first. Re-synced on connect,
  /// so a phone paired on Wi-Fi learns the tunnel addresses too.
  public var endpoints: [RemoteEndpoint]?
  public var capabilities: [String]
  public var hostName: String?
  public var pairedAt: Double?

  public var id: String { deviceId }

  public var hasControl: Bool { capabilities.contains("control") }

  public init(
    deviceId: String,
    devPrivB64: String,
    devPubB64: String,
    desktopPubB64: String,
    url: String,
    endpoints: [RemoteEndpoint]? = nil,
    capabilities: [String],
    hostName: String? = nil,
    pairedAt: Double? = nil
  ) {
    self.deviceId = deviceId
    self.devPrivB64 = devPrivB64
    self.devPubB64 = devPubB64
    self.desktopPubB64 = desktopPubB64
    self.url = url
    self.endpoints = endpoints
    self.capabilities = capabilities
    self.hostName = hostName
    self.pairedAt = pairedAt
  }

  public var keypair: NoiseKeypair? {
    guard let priv = ArgusBase64.decode(devPrivB64),
      let pub = ArgusBase64.decode(devPubB64)
    else { return nil }
    return NoiseKeypair(priv: priv, pub: pub)
  }

  public var desktopStaticKey: Data? { ArgusBase64.decode(desktopPubB64) }

  /// Label for a computer — its own name, else the gateway host.
  public var label: String {
    if let named = hostName?.trimmingCharacters(in: .whitespaces), !named.isEmpty {
      return named
    }
    return Self.gatewayHost(url)
  }

  public static func gatewayHost(_ url: String) -> String {
    var s = url
    for prefix in ["wss://", "ws://"] where s.hasPrefix(prefix) {
      s.removeFirst(prefix.count)
    }
    while s.hasSuffix("/") { s.removeLast() }
    return s
  }

  /// Classify a bare URL from a pre-endpoint-sync pairing, so a legacy identity
  /// still sorts sensibly once real endpoints arrive alongside it.
  public static func inferEndpointKind(_ url: String) -> RemoteEndpoint.Kind {
    if url.range(of: #"\.ts\.net(:\d+)?(/|$)"#, options: [.regularExpression, .caseInsensitive]) != nil {
      return .tailscale
    }
    if url.range(of: #"trycloudflare\.com"#, options: [.regularExpression, .caseInsensitive]) != nil
      || url.lowercased().hasPrefix("wss://")
    {
      return .cloudflare
    }
    return .lan
  }

  /// Folds what the computer advertises right now into what this phone already
  /// knows. A live address replaces the remembered one of its kind; a kind that
  /// isn't live (Tailscale switched off, a tunnel restarting) keeps its last
  /// address, so connecting once without it doesn't lose the way back in.
  public static func mergedEndpoints(
    known: [RemoteEndpoint]?, live: [RemoteEndpoint]
  ) -> [RemoteEndpoint] {
    let liveKinds = Set(live.map(\.kind))
    let kept = (known ?? []).filter { !liveKinds.contains($0.kind) }
    var seen = Set<RemoteEndpoint.Kind>()
    return (live + kept)
      .filter { seen.insert($0.kind).inserted }
      .sorted { $0.priority < $1.priority }
  }

  /// Addresses to try, best first. Falls back to the single paired URL when the
  /// desktop has never synced its list.
  public var candidateEndpoints: [RemoteEndpoint] {
    var all = endpoints ?? []
    // The paired URL stays a candidate — it's the only one a legacy identity
    // has, and it's still valid if the desktop is mid-restart advertising none.
    if !url.isEmpty, !all.contains(where: { $0.url == url }) {
      let kind = Self.inferEndpointKind(url)
      all.append(RemoteEndpoint(kind: kind, url: url, priority: kind.priority))
    }
    return all.sorted { $0.priority < $1.priority }
  }
}

/// Every pairing this phone holds, plus which one is connected.
public struct PairedHosts: Codable, Sendable {
  public var hosts: [DeviceIdentity]
  /// Null once the last pairing is removed.
  public var activeId: String?

  public static let empty = PairedHosts(hosts: [], activeId: nil)

  public init(hosts: [DeviceIdentity], activeId: String?) {
    self.hosts = hosts
    self.activeId = activeId
  }
}
