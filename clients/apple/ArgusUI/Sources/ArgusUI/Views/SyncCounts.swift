import ArgusCore
import SwiftUI

/// Commits behind and ahead of the upstream: ↓ in warning, ↑ muted. Nothing
/// without an upstream or when level with it.
public struct SyncCounts: View {
  @Environment(\.theme) private var theme
  let status: RemoteGitStatus
  let font: Font

  public init(status: RemoteGitStatus, font: Font = .scaled(size: 10, weight: .medium)) {
    self.status = status
    self.font = font
  }

  public var body: some View {
    let ahead = Int(status.ahead)
    let behind = Int(status.behind)
    if let upstream = status.upstream, ahead > 0 || behind > 0 {
      HStack(spacing: 4) {
        if behind > 0 { Text("↓\(behind)").foregroundStyle(theme.warning) }
        if ahead > 0 { Text("↑\(ahead)") }
      }
      .font(font.monospacedDigit())
      .foregroundStyle(theme.textMuted)
      .fixedSize()
      .help(Self.help(upstream: upstream, ahead: ahead, behind: behind))
      .accessibilityLabel(Self.help(upstream: upstream, ahead: ahead, behind: behind))
    }
  }

  static func help(upstream: String, ahead: Int, behind: Int) -> String {
    [
      behind > 0 ? "\(behind) commit\(behind == 1 ? "" : "s") behind \(upstream)" : nil,
      ahead > 0 ? "\(ahead) commit\(ahead == 1 ? "" : "s") ahead of \(upstream)" : nil,
    ].compactMap { $0 }.joined(separator: ", ")
  }
}
