import ArgusCore
import SwiftUI

/// One session as a row: a dot when something's happening, its title, a line
/// for setup or errors, and how long ago its agents were last active. The Mac
/// sidebar and the phone's project list and iPad sidebar all draw it.
public struct SessionRow: View {
  @Environment(\.theme) private var theme
  let activity: SessionActivity
  let git: RemoteGitStatus?
  /// The phone also says which branch and how many agents, since it has no hover card.
  var detailed: Bool
  /// On a selected iPad sidebar row: the system colours its labels for the fill, tinted or greyed.
  var selected: Bool

  public init(
    session: RemoteSession, agents: [RemoteAgentStatus], git: RemoteGitStatus? = nil, detailed: Bool = false,
    selected: Bool = false
  ) {
    activity = SessionActivity(session: session, agents: agents)
    self.git = git
    self.detailed = detailed
    self.selected = selected
  }

  private var session: RemoteSession { activity.session }

  public var body: some View {
    HStack(spacing: Self.spacing) {
      StatusDot(tone: activity.tone, pulse: activity.isBusy && !session.isUnavailable)
        .opacity(activity.showsDot ? 1 : 0)
        .frame(width: 8)
      VStack(alignment: .leading, spacing: detailed ? 2 : 1) {
        Text(activity.title)
          .font(Self.titleFont)
          .foregroundStyle(selected ? AnyShapeStyle(.primary) : AnyShapeStyle(theme.text))
          .lineLimit(1)
        if let detail {
          Text(detail)
            .font(Self.detailFont)
            .foregroundStyle(selected ? AnyShapeStyle(.secondary) : AnyShapeStyle(session.status == .error ? theme.error : theme.textMuted))
            .lineLimit(1)
        }
      }
      .layoutPriority(1)
      Spacer(minLength: 4)
      trailing
    }
    .padding(.vertical, detailed ? 2 : 4)
    .opacity(session.isUnavailable ? 0.5 : 1)
    .accessibilityElement(children: .combine)
  }

  @ViewBuilder private var trailing: some View {
    if let fraction = session.progress?.fraction, session.status != .ready {
      ProgressView(value: fraction).progressViewStyle(.circular).controlSize(.mini)
    } else if session.isUnavailable {
      Image(systemName: Icon.drive).font(Self.detailFont).foregroundStyle(theme.textMuted)
    } else {
      HStack(spacing: 8) {
        if let pullRequest = session.pullRequest {
          PullRequestStateIcon(pullRequest, size: Self.prIconSize)
        }
        if detailed, let git, let additions = git.diffAdditions, let deletions = git.diffDeletions {
          ChangeCounts(additions: additions, deletions: deletions)
        }
        if let lastActive = activity.lastActive {
          Text(ChromeText.shortAge(lastActive))
            .font(Self.detailFont.monospacedDigit())
            .foregroundStyle(selected ? AnyShapeStyle(.secondary) : AnyShapeStyle(theme.textMuted))
            // The title truncates first; an age broken across lines reads as nothing.
            .fixedSize()
        }
      }
    }
  }

  /// Setup, an error or a missing drive; when detailed, otherwise the branch and agent count.
  private var detail: String? {
    if session.isUnavailable { return "\(session.unavailableVolume ?? "Drive") unavailable" }
    if session.status != .ready { return activity.statusText }
    guard detailed else { return nil }
    let parts = [activity.subtitle, activity.statusText].compactMap { $0 }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
  }

  #if os(iOS)
    private static let spacing: CGFloat = 10
    private static let prIconSize: CGFloat = 14
    private static var titleFont: Font { .scaled(.body) }
    private static var detailFont: Font { .scaled(.footnote) }
  #else
    private static let spacing: CGFloat = 6
    private static let prIconSize: CGFloat = 12
    private static var titleFont: Font { .scaled(size: 13) }
    private static var detailFont: Font { .scaled(size: 11) }
  #endif
}

/// A `SessionFact`'s value: plain, a monospaced ref, change counts, an age or a pull request link.
public struct SessionFactValue: View {
  @Environment(\.theme) private var theme
  @Environment(\.openURL) private var openURL
  let fact: SessionFact
  var size: CGFloat?

  /// `size` fixes the type, as the Mac's hover card does; nil takes the surrounding font.
  public init(_ fact: SessionFact, size: CGFloat? = nil) {
    self.fact = fact
    self.size = size
  }

  public var body: some View {
    switch fact.value {
    case .changes(let additions, let deletions):
      ChangeCounts(additions: additions, deletions: deletions)
    case .text(let text): label(text, mono: false)
    case .ref(let ref): label(ref, mono: true)
    case .age(let millis): label("\(ChromeText.shortAge(millis)) ago", mono: false)
    case .pullRequest(let pr): pullRequest(pr)
    }
  }

  private func pullRequest(_ pr: RemoteSessionPullRequest) -> some View {
    Button {
      if let url = URL(string: pr.url) { openURL(url) }
    } label: {
      HStack(spacing: 4) {
        PullRequestStateIcon(pr, size: size ?? 12, opensPullRequest: false)
        Text("#\(pr.number)")
          .font(size.map { .scaled(size: $0) })
          .foregroundStyle(theme.accent)
      }
    }
    .buttonStyle(.argusPlain)
    .help("Open on GitHub")
    .accessibilityLabel(PullRequestLabels.state(pr))
    .accessibilityHint("Opens it on GitHub")
  }

  private func label(_ text: String, mono: Bool) -> some View {
    Text(text)
      .font(size.map { mono ? .scaled(size: $0).monospaced() : .scaled(size: $0) } ?? (mono ? .body.monospaced() : nil))
      .foregroundStyle(color)
      .lineLimit(2)
      .truncationMode(.middle)
  }

  private var color: Color {
    switch fact.emphasis {
    case .none: theme.textSecondary
    case .warning: theme.warning
    case .danger: theme.error
    }
  }
}
