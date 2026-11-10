import ArgusUI
import SwiftUI

/// Review what the agent changed, then land it: the git status summary, the
/// diff, and commit/push/merge for a device holding `control`. Conflict
/// resolution stays on the desktop — the computer refuses a conflicting merge
/// rather than dropping a half-merged tree on a phone.
struct ChangesView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @Environment(\.stackPush) private var stackPush

  let sessionId: String
  let label: String

  @State private var mode = "branch"
  @State private var diff: String?
  /// Why the diff didn't load; a failed refresh keeps the last diff on screen.
  @State private var failure: String?

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

      if diff == nil, let failure {
        EmptyState(icon: Icon.warning, title: "Couldn't load changes", body: failure, selectable: true) {
          Btn(label: "Retry", tone: .secondary, small: true, icon: Icon.refresh) { Task { await refresh() } }
            .fixedSize()
        }
      } else if diff == nil {
        Loading(label: "Loading changes…")
      } else if files.isEmpty {
        EmptyState(
          icon: Icon.branch,
          title: "No changes",
          body: mode == "branch"
            ? "This session has no changes vs its base branch — try Uncommitted for working-tree edits."
            : "No uncommitted changes in the working tree.")
      } else {
        // A list to pick from; each file's diff is a screen of its own.
        Card {
          VStack(spacing: 0) {
            ForEach(Array(files.enumerated()), id: \.element.id) { index, file in
              if index > 0 { Divider().padding(.leading, 24) }
              StackLink(route: .fileDiff(sessionId: sessionId, path: file.displayPath, mode: mode), chevron: false) {
                ChangedFileRow(file: file).padding(.vertical, 8)
              }
              .buttonStyle(.argusPlain)
            }
          }
        }
      }

      if host.hasControl {
        LandWorkCard(sessionId: sessionId, allowsAmend: true) {
          await refresh()
        } onDeleted: {
          router.popToRoot()
        }
      }
    }
    .navigationTitle("Changes · \(label)")
    .navigationBarTitleDisplayMode(.inline)
    .screenBar {
      if host.hasControl {
        Button {
          Task { await requestReview() }
        } label: {
          Label("Review code", systemImage: Icon.sideQuestion)
        }
        .disabled(files.isEmpty)
      }
      if let stackPush {
        Button { stackPush(.stashes(sessionId: sessionId, label: label)) } label: {
          Label("Stashes & tags", systemImage: Icon.history)
        }
      } else {
        NavigationLink(value: Route.stashes(sessionId: sessionId, label: label)) {
          Label("Stashes & tags", systemImage: Icon.history)
        }
      }
    }
    .liveRefresh(enabled: host.connection == .ready, every: .seconds(5)) { await refresh() }
    .loadsOffline { await refresh() }
    .diffReviewBar(sessionId: sessionId) { openAgent($0) }
    .onChange(of: mode) { _, _ in
      diff = nil
      failure = nil
      Task { await refresh() }
    }
  }

  /// A new agent, asked to review the session's diff before it's committed.
  private func requestReview() async {
    let session = host.session(id: sessionId)
    let base = session?.kind == .worktree ? session?.baseBranch : nil
    if let agentId = await host.requestCodeReview(sessionId: sessionId, baseBranch: base, defaults: AgentStartDefaults()) {
      openAgent(agentId)
    }
  }

  private func openAgent(_ agentId: String) {
    let label = host.statusByAgent[agentId].map(Labels.agentName) ?? "Agent"
    (stackPush ?? router.push)(.agent(id: agentId, label: label))
  }

  private func statusLine(_ status: RemoteGitStatus) -> String {
    var parts = [status.branch]
    if status.ahead > 0 { parts.append("↑\(status.ahead)") }
    if status.behind > 0 { parts.append("↓\(status.behind)") }
    // The working tree, whichever diff is on screen: say so.
    parts.append(status.dirtyCount > 0 ? "\(status.dirtyCount) uncommitted" : "nothing uncommitted")
    if status.conflictCount > 0 { parts.append("\(status.conflictCount) conflicts") }
    return parts.joined(separator: " · ")
  }

  private func refresh() async {
    await host.loadGitStatus(sessionId: sessionId)
    let asked = mode
    do {
      let loaded = try await host.loadDiff(sessionId: sessionId, mode: asked)
      // A switch of mode mid-load would otherwise get the other mode's diff.
      guard asked == mode else { return }
      diff = loaded
      failure = nil
    } catch where !HostStore.isQuiet(error) {
      if asked == mode { failure = HostStore.describe(error) }
    } catch {}
  }
}
