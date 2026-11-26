import ArgusCore
import SwiftUI

/// A cross-project session's repositories, one row each: the project, its
/// branch and where its worktree stands. Picking one opens that repository's
/// git view, where it commits, merges and opens its pull request on its own.
public struct CrossProjectRepoList: View {
  @Environment(\.theme) private var theme
  let repos: [CrossProjectRepo]
  /// The repository on screen, marked instead of offered.
  let currentSessionId: String
  let select: (CrossProjectRepo) -> Void

  public init(repos: [CrossProjectRepo], currentSessionId: String, select: @escaping (CrossProjectRepo) -> Void) {
    self.repos = repos
    self.currentSessionId = currentSessionId
    self.select = select
  }

  public var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      ForEach(repos) { repo in
        // Not disabled: a disabled row dims, and the one on screen should read clearest.
        Button {
          if repo.sessionId != currentSessionId { select(repo) }
        } label: {
          row(repo)
        }
        .buttonStyle(.argusPlain)
        .accessibilityLabel(Self.accessibilityLabel(repo, current: repo.sessionId == currentSessionId))
      }
    }
  }

  private func row(_ repo: CrossProjectRepo) -> some View {
    let current = repo.sessionId == currentSessionId
    return HStack(spacing: 8) {
      ProjectBadge(repo.name, key: repo.repoRoot, size: 18)
      VStack(alignment: .leading, spacing: 1) {
        Text(repo.name)
          .font(.scaled(size: 13, weight: current ? .semibold : .regular))
          .foregroundStyle(theme.text)
          .lineLimit(1)
        Text(repo.branch)
          .font(.scaled(size: 11, design: .monospaced))
          .foregroundStyle(theme.textMuted)
          .lineLimit(1)
          .truncationMode(.middle)
      }
      Spacer(minLength: 6)
      if let state = Self.state(repo) {
        Badge(label: state.label, tone: state.tone)
      }
      Image(systemName: current ? Icon.check : Icon.chevronRight)
        .font(.scaled(size: 11, weight: .semibold))
        .foregroundStyle(current ? theme.accent : theme.textMuted)
    }
    .padding(.horizontal, 8)
    .padding(.vertical, 6)
    .background(current ? theme.selection : .clear, in: .rect(cornerRadius: theme.radiusSmall))
    .contentShape(.rect)
  }

  /// Setup first, then where its pull request stands; nothing for a ready one without a PR.
  nonisolated static func state(_ repo: CrossProjectRepo) -> (label: String, tone: Tone)? {
    guard let session = repo.session else { return ("Loading", .muted) }
    switch session.status {
    case .initializing: return ("Setting up", .muted)
    case .error: return ("Setup failed", .danger)
    case .deleting: return ("Removing", .muted)
    case .ready: break
    }
    if session.isUnavailable { return ("Drive missing", .warning) }
    guard let pr = session.pullRequest else { return nil }
    switch pr.state {
    case .open: return ("PR #\(pr.number)", .accent)
    case .draft: return ("Draft #\(pr.number)", .muted)
    case .merged: return ("Merged", .success)
    case .closed: return ("Closed", .muted)
    }
  }

  nonisolated static func accessibilityLabel(_ repo: CrossProjectRepo, current: Bool) -> String {
    let state = Self.state(repo).map { ", \($0.label)" } ?? ""
    return "\(repo.name), branch \(repo.branch)\(state)\(current ? ", shown" : "")"
  }
}
