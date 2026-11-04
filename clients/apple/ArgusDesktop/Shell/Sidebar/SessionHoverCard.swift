import ArgusCore
import ArgusUI
import SwiftUI

/// What resting the pointer on a sidebar session shows: its branch and where
/// it came from, its pull request, how much it changed, how it stands against its upstream, and
/// what its agents are up to.
struct SessionHoverCard: View {
  @Environment(\.theme) private var theme
  let session: RemoteSession
  let git: RemoteGitStatus?
  let activity: SessionActivity

  private var branch: String { git?.branch ?? session.branch }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      VStack(alignment: .leading, spacing: 3) {
        Text(activity.title)
          .font(.scaled(size: 13, weight: .semibold))
          .foregroundStyle(theme.text)
          .lineLimit(2)
        Label {
          Text(branch).font(.scaled(size: 11).monospaced()).lineLimit(1).truncationMode(.middle)
        } icon: {
          Image(systemName: Icon.branch)
        }
        .font(.scaled(size: 11))
        .foregroundStyle(theme.textSecondary)
      }
      Divider().overlay(theme.borderSubtle)
      Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: 10, verticalSpacing: 5) {
        ForEach(activity.facts(git: git)) { fact in
          GridRow {
            Text(fact.label)
              .font(.scaled(size: 11))
              .foregroundStyle(theme.textMuted)
              .gridColumnAlignment(.trailing)
            SessionFactValue(fact, size: 11)
          }
        }
      }
    }
    .padding(12)
    .frame(width: 260, alignment: .leading)
    .floatingSurface()
    // The pull request fact is the card's only link.
    .environment(
      \.openURL,
      OpenURLAction { _ in
        MacTelemetry.capture(.sessionHoverCardPullRequestOpened)
        return .systemAction
      })
  }
}
