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

  /// What the diff covers, as `SessionDiffScope.mode`: a branch, the working copy or an agent turn.
  @State private var mode: String
  @State private var turns: [SessionTurn] = []
  @State private var diff: String?
  /// Why the diff didn't load; a failed refresh keeps the last diff on screen.
  @State private var failure: String?
  @State private var viewed: ViewedFiles?

  init(sessionId: String, label: String, mode: String = "branch") {
    self.sessionId = sessionId
    self.label = label
    _mode = State(initialValue: mode)
  }

  private var files: [DiffFile] { diff.map(DiffParser.parse) ?? [] }

  var body: some View {
    Screen {
      SegmentedControl(
        value: segment,
        options: [("branch", "Branch"), ("working", "Uncommitted"), ("turn", "Last turn")])
      if isTurn { turnPicker }

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
          body: emptyMessage)
      } else {
        if let viewed {
          ViewedProgressBar(viewed: viewed.viewedCount(files.map(\.displayPath)), total: files.count)
        }
        // A list to pick from; each file's diff is a screen of its own.
        Card {
          VStack(spacing: 0) {
            ForEach(Array(files.enumerated()), id: \.element.id) { index, file in
              if index > 0 { Divider().padding(.leading, 24) }
              StackLink(route: .fileDiff(sessionId: sessionId, path: file.displayPath, mode: pinnedMode), chevron: false) {
                ChangedFileRow(file: file, viewedState: viewed?.state(file.displayPath)).padding(.vertical, 8)
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
    .onChange(of: mode) { _, next in
      host.trackDiffScope(SessionDiffScope(mode: next, turns: turns))
      diff = nil
      failure = nil
      Task { await refresh() }
    }
  }

  private var isTurn: Bool { mode.hasPrefix("turn") }

  /// The segments pick a kind of scope; a pinned turn still sits under Last turn.
  private var segment: Binding<String> {
    Binding(get: { isTurn ? "turn" : mode }, set: { if $0 != (isTurn ? "turn" : mode) { mode = $0 } })
  }

  private var scope: SessionDiffScope { SessionDiffScope(mode: mode, turns: turns) }

  /// A file opened from the last turn stays on that turn, even once another starts.
  private var pinnedMode: String {
    if mode == "turn", let latest = turns.last { return SessionDiffScope.turn(latest).mode }
    return mode
  }

  private var emptyMessage: String {
    switch mode {
    case "branch": "This session has no changes vs its base branch — try Uncommitted for working-tree edits."
    case "working": "No uncommitted changes in the working tree."
    default: turns.isEmpty ? "No agent has run a prompt in this session yet." : "This turn didn't change any files."
    }
  }

  /// Which turn: the latest by default, or any earlier one.
  private var turnPicker: some View {
    Menu {
      Button("Last turn") { mode = "turn" }
      ForEach(turns.reversed()) { turn in
        Button("Turn \(turn.number) · \(turn.prompt)") { mode = SessionDiffScope.turn(turn).mode }
      }
    } label: {
      HStack(spacing: 6) {
        MutedText(turnLabel, lineLimit: 1)
        Image(systemName: Icon.chevronDown).font(.scaled(.caption).weight(.semibold)).foregroundStyle(.tertiary)
        Spacer(minLength: 0)
      }
      .contentShape(Rectangle())
    }
    .disabled(turns.isEmpty)
  }

  private var turnLabel: String {
    guard let turn = scope.turn(in: turns) else { return "No turns yet" }
    let which = mode == "turn" ? "Last turn (\(turn.number))" : "Turn \(turn.number)"
    return turn.prompt.isEmpty ? which : "\(which) · \(turn.prompt)"
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
    if asked.hasPrefix("turn") {
      // Viewed marks belong to the branch and the working copy; a turn is a look back.
      viewed = nil
      if let loaded = try? await host.loadSessionTurns(sessionId: sessionId) { turns = loaded }
    } else {
      if viewed?.scope != .session(id: sessionId, mode: asked) {
        viewed = ViewedFiles(scope: .session(id: sessionId, mode: asked), host: host)
      }
      await viewed?.load()
    }
    do {
      let wire = SessionDiffScope.wire(mode: asked)
      let loaded = try await host.loadDiff(sessionId: sessionId, mode: wire.mode, checkpointId: wire.checkpointId)
      // A switch of mode mid-load would otherwise get the other mode's diff.
      guard asked == mode else { return }
      diff = loaded
      failure = nil
    } catch where !HostStore.isQuiet(error) {
      if asked == mode { failure = HostStore.describe(error) }
    } catch {}
  }
}
