import ArgusUI
import SwiftUI

/// Review what the agent changed, then land it: the git status summary, the
/// diff, and commit/push/merge for a device holding `control`. Conflict
/// resolution stays on the desktop — the computer refuses a conflicting merge
/// rather than dropping a half-merged tree on a phone.
struct ChangesView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host

  let sessionId: String
  let label: String

  @State private var mode = "branch"
  @State private var diff: String?

  private var files: [DiffFile] { diff.map(DiffParser.parse) ?? [] }

  var body: some View {
    Screen {
      SegmentedControl(
        value: $mode,
        options: [("branch", "Vs base branch"), ("working", "Uncommitted")])

      if let status = host.gitStatusBySession[sessionId] {
        HStack(spacing: 8) {
          StatusDot(tone: status.conflictCount > 0 ? .warning : .accent)
          MutedText(statusLine(status), lineLimit: 1)
        }
      }

      if diff == nil {
        Loading(label: "Loading changes…")
      } else if files.isEmpty {
        EmptyState(
          icon: Icon.branch,
          title: "No changes",
          body: mode == "branch"
            ? "This session has no changes vs its base branch — try Uncommitted for working-tree edits."
            : "No uncommitted changes in the working tree.")
      } else {
        ForEach(files) { file in
          FileDiffCard(file: file)
        }
      }

      if host.hasControl {
        LandWorkCard(sessionId: sessionId, allowsAmend: true) { await refresh() }
      }
    }
    .navigationTitle("Changes · \(label)")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        NavigationLink(value: Route.stashes(sessionId: sessionId, label: label)) {
          Label("Stashes & tags", systemImage: Icon.history)
        }
      }
    }
    .liveRefresh(enabled: host.connection == .ready, every: .seconds(5)) { await refresh() }
    .onChange(of: mode) { _, _ in
      diff = nil
      Task { await refresh() }
    }
  }

  private func statusLine(_ status: RemoteGitStatus) -> String {
    var parts = [status.branch]
    if status.ahead > 0 { parts.append("↑\(status.ahead)") }
    if status.behind > 0 { parts.append("↓\(status.behind)") }
    parts.append(status.dirtyCount > 0 ? "\(status.dirtyCount) changed" : "clean")
    if status.conflictCount > 0 { parts.append("\(status.conflictCount) conflicts") }
    return parts.joined(separator: " · ")
  }

  private func refresh() async {
    await host.loadGitStatus(sessionId: sessionId)
    diff = await host.loadDiff(sessionId: sessionId, mode: mode)
  }
}
