import ArgusKit
import SwiftUI

/// A teammate's face: its symbol, or its initials, on its own colour. The
/// colours are the project-accent palette, so they hold in both themes.
public struct TeammateAvatar: View {
  let name: String
  let color: ArgusProtocol.TeammateColor
  let avatar: ArgusProtocol.TeammateAvatar
  let size: CGFloat

  public init(teammate: ArgusProtocol.Teammate, size: CGFloat = 32) {
    self.init(name: teammate.name, color: teammate.color, avatar: teammate.avatar, size: size)
  }

  public init(
    name: String, color: ArgusProtocol.TeammateColor, avatar: ArgusProtocol.TeammateAvatar,
    size: CGFloat = 32
  ) {
    self.name = name
    self.color = color
    self.avatar = avatar
    self.size = size
  }

  public var body: some View {
    let tint = Self.tint(color)
    ZStack {
      Circle().fill(tint.opacity(0.18))
      switch avatar {
      case .symbol(let symbol):
        Image(systemName: Self.systemName(symbol.symbol))
          .font(.system(size: size * 0.45, weight: .semibold))
          .foregroundStyle(tint)
      case .initials, .unknown:
        Text(Self.initials(name))
          .font(.system(size: size * 0.38, weight: .semibold))
          .foregroundStyle(tint)
      }
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }

  public static func tint(_ color: ArgusProtocol.TeammateColor) -> Color {
    let hex: UInt32 =
      switch color.rawValue {
      case "green": 0x22C55E
      case "orange": 0xFF7A59
      case "pink": 0xE879F9
      case "purple": 0x7C5CFC
      case "red": 0xFF4466
      case "teal": 0x00D4AA
      case "yellow": 0xF5A623
      default: 0x4D9FFF
      }
    return Color(hex: hex)
  }

  public static func systemName(_ symbol: ArgusProtocol.TeammateSymbol) -> String {
    switch symbol.rawValue {
    case "wrench": "wrench.and.screwdriver"
    case "tray": "tray.full"
    case "doc": "doc.text"
    case "eye", "shippingbox", "ant", "calendar", "leaf", "sparkles", "bolt", "magnifyingglass":
      symbol.rawValue
    default: "person"
    }
  }

  static func initials(_ name: String) -> String {
    let words = name.split(whereSeparator: { $0 == " " || $0 == "-" })
    return words.prefix(2).compactMap(\.first).map(String.init).joined().uppercased()
  }
}

/// One teammate in a list, read like a chat: who, what you last talked about, and when.
public struct TeammateRow: View {
  @Environment(\.theme) private var theme
  let summary: ArgusProtocol.TeammateSummary
  let avatarSize: CGFloat

  public init(summary: ArgusProtocol.TeammateSummary, avatarSize: CGFloat = 40) {
    self.summary = summary
    self.avatarSize = avatarSize
  }

  public var body: some View {
    let teammate = summary.teammate
    HStack(spacing: 12) {
      TeammateAvatar(teammate: teammate, size: avatarSize)
        .opacity(teammate.enabled ? 1 : 0.5)
        .overlay(alignment: .bottomTrailing) {
          if summary.working == true {
            StatusDot(tone: .accent, pulse: true, accessibilityLabel: "Working")
              .padding(2)
              .background(Circle().fill(theme.bgSecondary))
          }
        }
      VStack(alignment: .leading, spacing: 3) {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
          Text(teammate.name).fontWeight(.medium).lineLimit(1)
          if !teammate.enabled {
            Text("Paused").font(.scaled(.caption)).foregroundStyle(.tertiary)
          }
          Spacer(minLength: 6)
          if let at = TeammateSummaryText.lastActivity(summary) {
            Text(Labels.timeAgo(at)).font(.scaled(.footnote)).foregroundStyle(.secondary).lineLimit(1)
          }
        }
        HStack(spacing: 6) {
          Text(TeammateSummaryText.preview(summary))
            .font(.scaled(.subheadline))
            .foregroundStyle(summary.working == true ? AnyShapeStyle(theme.accent) : AnyShapeStyle(.secondary))
            .lineLimit(1)
          Spacer(minLength: 6)
          if summary.hasUnreadReport {
            StatusDot(tone: .accent, accessibilityLabel: "New report")
          }
        }
      }
    }
    .padding(.vertical, 2)
  }
}

/// The chat-list wording for a teammate, shared by every list of them.
public enum TeammateSummaryText {
  public static func preview(_ summary: ArgusProtocol.TeammateSummary) -> String {
    if summary.working == true { return "Working on a duty" }
    if let title = summary.latestThread?.title, !title.isEmpty { return title }
    if !summary.teammate.tagline.isEmpty { return summary.teammate.tagline }
    return "No conversations yet"
  }

  /// The newer of its last duty run and its last conversation.
  public static func lastActivity(_ summary: ArgusProtocol.TeammateSummary) -> Double? {
    [summary.lastRunAt, summary.latestThread?.lastOpenedAt].compactMap { $0 }.max()
  }
}
