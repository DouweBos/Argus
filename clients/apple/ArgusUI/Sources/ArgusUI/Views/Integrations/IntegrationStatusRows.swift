import ArgusCore
import SwiftUI

/// How an integration's state reads, on the Mac and the phone.
public enum IntegrationLabels {
  public static func name(_ id: ArgusProtocol.IntegrationId) -> String {
    switch id {
    case .linear: "Linear"
    case .figma: "Figma"
    default: id.rawValue.capitalized
    }
  }

  public static func state(_ status: ArgusProtocol.IntegrationStatus) -> String {
    if !status.connected { return "Not connected" }
    return status.needsReauth ? "Reconnect" : "Connected"
  }

  public static func tone(_ status: ArgusProtocol.IntegrationStatus) -> Tone {
    if !status.connected { return .muted }
    return status.needsReauth ? .warning : .success
  }

  /// "Ada Lovelace · Acme", or nil when nothing is connected.
  public static func account(_ status: ArgusProtocol.IntegrationStatus) -> String? {
    guard status.connected, let account = status.account else { return nil }
    return [account.name, account.workspace].compactMap { $0 }.joined(separator: " · ")
  }
}

/// Each integration's row symbol: what it brings in rather than its brand.
public enum IntegrationIcon {
  public static func symbol(_ kind: IntegrationKind) -> String {
    switch kind {
    case .linear: Icon.issue
    case .figma: Icon.design
    case .slack: "number"
    }
  }
}
