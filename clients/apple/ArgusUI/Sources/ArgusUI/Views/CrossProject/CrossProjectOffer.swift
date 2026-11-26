import ArgusCore
import SwiftUI

/// Above the composer once a message links another project: offers to give the
/// session a worktree of it on the same branch, so the agent changes both and
/// each repository lands on its own.
public struct CrossProjectOffer: View {
  @Environment(HostStore.self) private var host
  let sessionId: String?
  let linked: [String]
  @State private var declined: Set<String> = []
  @State private var adding = false
  @State private var failures: [CrossProjectFailure] = []

  public init(sessionId: String?, linked: [String]) {
    self.sessionId = sessionId
    self.linked = linked
  }

  private var candidates: [RemoteProject] {
    guard host.hasControl, let sessionId else { return [] }
    return host.crossProjectCandidates(sessionId: sessionId, linked: linked).filter { !declined.contains($0.repoRoot) }
  }

  public var body: some View {
    let candidates = candidates
    VStack(alignment: .leading, spacing: 6) {
      if !candidates.isEmpty, let session = sessionId.flatMap(host.session(id:)) {
        Banner(
          text: Self.text(names: candidates.map(\.name), branch: session.branch, adding: adding),
          tone: .accent, title: "Make this a cross-project session?",
          actionLabel: adding ? nil : Self.actionLabel(count: candidates.count), actionTone: .primary,
          action: adding ? nil : { add(candidates.map(\.repoRoot)) },
          onDismiss: adding ? nil : { declined.formUnion(candidates.map(\.repoRoot)) }, wraps: true)
      }
      ForEach(failures, id: \.repoRoot) { failure in
        Banner(
          text: failure.error, tone: .danger,
          title: "Couldn't add \((failure.repoRoot as NSString).lastPathComponent)",
          onDismiss: { failures.removeAll { $0.repoRoot == failure.repoRoot } })
      }
    }
  }

  private func add(_ roots: [String]) {
    guard let sessionId else { return }
    adding = true
    Task {
      let failed = await host.makeCrossProject(sessionId: sessionId, repoRoots: roots)
      adding = false
      failures = failed ?? []
      // Refused outright: keep the error banner from the store and stop offering.
      if failed == nil { declined.formUnion(roots) }
    }
  }

  nonisolated static func actionLabel(count: Int) -> String { count == 1 ? "Add Worktree" : "Add Worktrees" }

  nonisolated static func text(names: [String], branch: String, adding: Bool) -> String {
    let list = ListFormatter.localizedString(byJoining: names)
    if adding { return "Making a worktree of \(list) on \(branch) and running its setup" }
    let each = names.count == 1 ? "It gets" : "Each gets"
    return "\(each) a worktree on \(branch) so the agent can change \(list) too, and lands on its own."
  }
}
