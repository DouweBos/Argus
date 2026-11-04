import ArgusKit
import SwiftUI

/// GitHub's pull request icon in its state's colour, as Peacock's `PullRequestState` draws it.
/// On the Mac it opens the PR; a phone row is one tap target, so there it is only a badge.
public struct PullRequestStateIcon: View {
  @Environment(\.theme) private var theme
  @Environment(\.openURL) private var openURL
  let pullRequest: RemoteSessionPullRequest
  var size: CGFloat

  public init(_ pullRequest: RemoteSessionPullRequest, size: CGFloat = 11) {
    self.pullRequest = pullRequest
    self.size = size
  }

  public var body: some View {
    #if os(macOS)
      Button {
        if let url = URL(string: pullRequest.url) { openURL(url) }
      } label: {
        icon
      }
      .buttonStyle(.argusPlain)
      .help(label)
      .accessibilityLabel(label)
    #else
      icon.accessibilityLabel(label)
    #endif
  }

  private var icon: some View {
    Image(systemName: Icon.pullRequest)
      .font(.scaled(size: size, weight: .semibold))
      .foregroundStyle(color)
  }

  private var label: String { PullRequestLabels.state(pullRequest) }

  private var color: Color {
    switch pullRequest.state {
    case .open: theme.prOpen
    case .draft: theme.prDraft
    case .merged: theme.prMerged
    case .closed: theme.prClosed
    }
  }
}
