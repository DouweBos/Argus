import ArgusCore
import SwiftUI

/// No workspace connected on the computer.
public struct SlackNotConnectedRow: View {
  public init() {}

  public var body: some View {
    HStack(spacing: 8) {
      BodyText("Slack")
      Spacer(minLength: 6)
      Badge(label: "Not connected", tone: .muted)
    }
  }
}

/// Read-only: one Slack workspace's connection, its owner and channel projects.
public struct SlackStatusRows: View {
  @Environment(\.theme) private var theme
  let status: ArgusProtocol.SlackStatus
  /// A mapping's repo root as the computer names the project.
  let projectName: (String) -> String

  public init(status: ArgusProtocol.SlackStatus, projectName: @escaping (String) -> String) {
    self.status = status
    self.projectName = projectName
  }

  public var body: some View {
    HStack(spacing: 8) {
      VStack(alignment: .leading, spacing: 2) {
        BodyText(status.configured ? status.workspace ?? "Slack" : "Slack")
        if let detail = SlackLabels.connectionDetail(status) { MutedText(detail, lineLimit: 2) }
      }
      Spacer(minLength: 6)
      Badge(
        label: status.configured ? SlackLabels.state(status.state) : "Not connected",
        tone: status.configured ? SlackLabels.tone(status.state) : .muted)
    }
    if status.configured {
      HStack(spacing: 8) {
        BodyText("Owner")
        Spacer(minLength: 6)
        MutedText(status.owner.map(SlackLabels.member) ?? "Not claimed yet", lineLimit: 1)
      }
      ForEach(status.mappings, id: \.channelId) { mapping in
        HStack(spacing: 8) {
          BodyText("#\(mapping.channelName)", lineLimit: 1)
          Spacer(minLength: 6)
          MutedText(projectName(mapping.repoRoot), lineLimit: 1)
        }
      }
    }
  }
}

public enum SlackLabels {
  public static func state(_ state: ArgusProtocol.SlackConnectionState) -> String {
    switch state {
    case .connected: "Connected"
    case .connecting: "Connecting"
    case .error: "Error"
    default: "Off"
    }
  }

  public static func tone(_ state: ArgusProtocol.SlackConnectionState) -> Tone {
    switch state {
    case .connected: .success
    case .connecting: .warning
    case .error: .danger
    default: .muted
    }
  }

  /// The error sentence when the socket is down, else the bot and its threads.
  public static func connectionDetail(_ status: ArgusProtocol.SlackStatus) -> String? {
    guard status.configured else { return nil }
    if status.state == .error, let error = status.error { return error }
    let threads = Int(status.threadCount)
    let parts = [
      status.botName.map { "@\($0)" },
      threads > 0 ? "\(threads) thread\(threads == 1 ? "" : "s") with an agent" : nil,
    ].compactMap { $0 }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
  }

  /// "Ada Lovelace · U0123ABCD", or the bare ID when Slack gave no name.
  public static func member(_ user: ArgusProtocol.SlackUser) -> String {
    user.name.map { "\($0) · \(user.userId)" } ?? user.userId
  }
}
