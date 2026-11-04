import ArgusKit
import SwiftUI

/// GitHub's pull request icon in its state's colour, as Peacock's `PullRequestState` draws it.
/// On the Mac it opens the PR; a phone row is one tap target, so there it is only a badge.
public struct PullRequestStateIcon: View {
  @Environment(\.theme) private var theme
  @Environment(\.openURL) private var openURL
  @ScaledMetric(relativeTo: .body) private var dynamicType: CGFloat = 1
  let pullRequest: RemoteSessionPullRequest
  var size: CGFloat

  public init(_ pullRequest: RemoteSessionPullRequest, size: CGFloat = 12) {
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
    let side = TextScale.shared(size) * dynamicType
    return Image(octicon, bundle: .module)
      .renderingMode(.template)
      .resizable()
      .frame(width: side, height: side)
      .foregroundStyle(color)
  }

  /// GitHub's own glyph per state, so a PR reads the same here as on github.com.
  private var octicon: String {
    switch pullRequest.state {
    case .open: "octicon-git-pull-request"
    case .draft: "octicon-git-pull-request-draft"
    case .merged: "octicon-git-merge"
    case .closed: "octicon-git-pull-request-closed"
    }
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
