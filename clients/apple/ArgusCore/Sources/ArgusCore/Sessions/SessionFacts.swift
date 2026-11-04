import Foundation

/// One labelled fact about a session — the Mac's hover card and the phone's
/// session details list the same ones, in the same order.
public struct SessionFact: Identifiable, Sendable, Equatable {
  public enum Value: Sendable, Equatable {
    case text(String)
    /// A branch or ref, set in monospace.
    case ref(String)
    case changes(additions: Int, deletions: Int)
    /// Epoch milliseconds; the view phrases it as an age.
    case age(Double)
    /// Its number and state, opening it on GitHub.
    case pullRequest(RemoteSessionPullRequest)
  }

  public enum Emphasis: Sendable, Equatable { case none, warning, danger }

  public var label: String
  public var value: Value
  public var emphasis: Emphasis = .none

  public var id: String { label }

  public init(_ label: String, _ value: Value, emphasis: Emphasis = .none) {
    self.label = label
    self.value = value
    self.emphasis = emphasis
  }
}

extension SessionActivity {
  /// The session's title: its name, else its branch.
  public var title: String { Self.title(session) }

  /// The branch, only when the title doesn't already say it.
  public var subtitle: String? { Self.subtitle(session) }

  public static func title(_ session: RemoteSession) -> String {
    session.displayName.flatMap { $0.isEmpty ? nil : $0 } ?? session.branch
  }

  public static func subtitle(_ session: RemoteSession) -> String? {
    title(session) == session.branch || session.branch.isEmpty ? nil : session.branch
  }

  /// Base, pull request, changes, upstream, conflicts, agents, activity and drive — whatever applies.
  public func facts(git: RemoteGitStatus?) -> [SessionFact] {
    var facts: [SessionFact] = []
    let branch = git?.branch ?? session.branch
    if let base = session.baseBranch, base != branch { facts.append(SessionFact("Base", .ref(base))) }
    if let pr = session.pullRequest { facts.append(SessionFact("Pull request", .pullRequest(pr))) }
    if let git {
      let additions = git.diffAdditions ?? 0
      let deletions = git.diffDeletions ?? 0
      facts.append(
        SessionFact(
          "Changes", additions != 0 || deletions != 0 ? .changes(additions: additions, deletions: deletions) : .text("None")))
      if git.dirtyCount > 0 { facts.append(SessionFact("Uncommitted", .text(Self.files(git.dirtyCount)))) }
      facts.append(
        SessionFact("Upstream", .text(GitUpstreamText.describe(git)), emphasis: git.behind > 0 ? .warning : .none))
      if git.conflictCount > 0 {
        facts.append(SessionFact("Conflicts", .text(Self.files(git.conflictCount)), emphasis: .danger))
      }
      if let progress = git.inProgress {
        let kind = progress.kind.capitalized
        facts.append(
          SessionFact("In progress", .text(progress.onto.map { "\(kind) onto \($0)" } ?? kind), emphasis: .warning))
      }
      if git.stashCount > 0 { facts.append(SessionFact("Stashes", .text("\(git.stashCount)"))) }
    }
    if let status = statusText {
      facts.append(SessionFact("Agents", .text(status), emphasis: session.status == .error ? .danger : .none))
    }
    if let lastActive { facts.append(SessionFact("Active", .age(lastActive))) }
    if let volume = session.volume { facts.append(SessionFact("Drive", .text(volume))) }
    return facts
  }

  private static func files(_ count: Int) -> String { "\(count) file\(count == 1 ? "" : "s")" }
}
