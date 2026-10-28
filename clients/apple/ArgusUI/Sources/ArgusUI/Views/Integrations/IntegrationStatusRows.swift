import ArgusCore
import SwiftUI

/// Read-only: which integrations the computer has connected, and as whom.
public struct IntegrationStatusRows: View {
  @Environment(\.theme) private var theme
  let integrations: [ArgusProtocol.IntegrationStatus]

  public init(integrations: [ArgusProtocol.IntegrationStatus]) {
    self.integrations = integrations
  }

  public var body: some View {
    ForEach(integrations, id: \.id.rawValue) { status in
      HStack(spacing: 8) {
        VStack(alignment: .leading, spacing: 2) {
          BodyText(IntegrationLabels.name(status.id))
          if let account = IntegrationLabels.account(status) {
            MutedText(account, lineLimit: 1)
          }
        }
        Spacer(minLength: 6)
        Badge(label: IntegrationLabels.state(status), tone: IntegrationLabels.tone(status))
      }
    }
  }
}

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
