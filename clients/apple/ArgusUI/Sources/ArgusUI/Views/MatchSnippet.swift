import ArgusCore
import Foundation
import SwiftUI

/// A saved chat's message line that matched the search, its hit in bold.
public struct MatchSnippet: View {
  @Environment(\.theme) private var theme
  let match: ChatHistoryMatch

  public init(match: ChatHistoryMatch) {
    self.match = match
  }

  public var body: some View {
    (Text(role).foregroundStyle(theme.textMuted) + Text("  ") + snippet)
      .font(.scaled(.caption))
      .foregroundStyle(theme.textSecondary)
      .lineLimit(2)
      .padding(.top, 2)
  }

  private var role: String {
    switch match.role {
    case .assistant: "Assistant"
    case .system: "System"
    default: "You"
    }
  }

  private var snippet: Text {
    let parts = match.parts
    return Text(parts.before) + Text(parts.hit).bold().foregroundStyle(theme.text) + Text(parts.after)
  }
}
