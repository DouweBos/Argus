import ArgusCore
import ArgusUI
import GroveUIKit
import SwiftUI

/// A session's version timeline: its agent turns newest first, beside the picked
/// turn's diff, with restoring the files to where a turn ended and undoing that.
struct TimelineScreen: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.theme) private var theme
  let workspace: GitWorkspace
  /// The routed turn; nil is the newest one that can be diffed.
  let turnId: String?

  private var vm: TimelineModel { workspace.timeline }
  private var selected: TimelineTurn? { vm.timeline.turn(turnId) }

  var body: some View {
    VStack(spacing: 0) {
      if let error = vm.actionError {
        GitErrorBanner(message: error) { vm.actionError = nil }
      }
      ResizableHSplit(key: "git.timeline", leadingMin: 280, leadingIdeal: 380, leadingMax: 560, trailingMin: 320) {
        VStack(spacing: 0) {
          listHeader
          list
        }
        .frame(maxHeight: .infinity)
      } trailing: {
        detail.frame(maxHeight: .infinity)
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .modifier(RestoreConfirmation(vm: vm))
    // A restore moves the files, which bumps the generation.
    .task(id: workspace.generation) { await vm.load() }
    .task(id: DiffKey(turn: selected?.checkpointId, generation: workspace.generation)) { await loadDiff() }
  }

  private var listHeader: some View {
    PanelHeader(title: "Timeline", detail: vm.timeline.turns.isEmpty ? nil : turnsLabel) {
      if vm.isLoading || vm.isPerforming { ProgressView().controlSize(.small) }
    }
  }

  private var turnsLabel: String { vm.timeline.turns.count == 1 ? "1 turn" : "\(vm.timeline.turns.count) turns" }

  private var list: some View {
    List(vm.timeline.entries) { entry in
      switch entry {
      case .turn(let turn):
        TimelineTurnRow(turn: turn)
          .padding(.vertical, 3)
          .frame(maxWidth: .infinity, alignment: .leading)
          .contentShape(.rect)
          .onTapGesture { pick(turn) }
          .clickable(turn.available)
          .modifier(NavigatorRowHighlight(selected: selected?.checkpointId == turn.checkpointId))
          .contextMenu { menu(turn) }
      case .restore(let restore):
        TimelineRestoreRow(restore: restore, undo: restore.canUndo ? { Task { await vm.undo(restore) } } : nil)
          .padding(.vertical, 3)
          .disabled(vm.isPerforming || vm.timeline.busy)
      }
    }
    .navigatorList()
    .overlay {
      if let error = vm.loadError, !vm.loaded {
        GitEmptyState(systemImage: "exclamationmark.triangle", title: "Couldn't load the timeline", subtitle: error)
      } else if vm.loaded && vm.timeline.turns.isEmpty {
        GitEmptyState(
          systemImage: Icon.timeline, title: "No turns yet",
          subtitle: "Every prompt an agent runs here gets a version you can look back at and restore.")
      }
    }
  }

  @ViewBuilder
  private func menu(_ turn: TimelineTurn) -> some View {
    Button("Restore to This Version") { vm.confirming = turn }
      .disabled(!canRestore(turn))
    Button("Show in Changes") {
      workspace.scopedDiff.pick(.turn(turn.sessionTurn))
      model.navigate(.sessionGit(id: workspace.sessionId, view: .working))
    }
    .disabled(!turn.available)
  }

  @ViewBuilder
  private var detail: some View {
    if let turn = selected {
      VStack(spacing: 0) {
        detailHeader(turn)
        ResizableVSplit(key: "git.timeline.diff", topMin: 100, bottomMin: 160, bottomIdeal: 420, showsBottom: true) {
          ScopedChangesList(workspace: workspace, model: workspace.timelineDiff)
        } bottom: {
          ScopedDiffPane(workspace: workspace, scopedModel: workspace.timelineDiff)
        }
      }
    } else if vm.loaded {
      GitEmptyState(systemImage: Icon.timeline, title: "Select a turn")
    }
  }

  private func detailHeader(_ turn: TimelineTurn) -> some View {
    HStack(spacing: 8) {
      Text("Turn \(turn.number)")
        .font(.scaled(size: 12, weight: .medium))
        .fixedSize()
      Text(turn.prompt)
        .font(.scaled(size: 12))
        .foregroundStyle(theme.textSecondary)
        .lineLimit(1)
        .help(turn.prompt)
      Spacer(minLength: 8)
      Button {
        vm.confirming = turn
      } label: {
        Label("Restore to This Version", systemImage: Icon.restoreVersion)
      }
      .buttonStyle(QuietTabButtonStyle())
      .disabled(!canRestore(turn))
      .help(restoreHelp(turn))
    }
    .padding(.horizontal, 12)
    .frame(height: 34)
    .overlay(alignment: .bottom) { Rectangle().fill(theme.border).frame(height: 1) }
  }

  private func canRestore(_ turn: TimelineTurn) -> Bool {
    turn.canRestore && !vm.timeline.busy && !vm.isPerforming
  }

  private func restoreHelp(_ turn: TimelineTurn) -> String {
    if !turn.available { return "This turn's checkpoint is gone" }
    if !turn.finished { return "This turn hasn't finished yet" }
    if vm.timeline.busy { return "An agent in this session is working; restore once it's done" }
    return "Put the files back to how they were when this turn ended; the conversation stays"
  }

  private func pick(_ turn: TimelineTurn) {
    guard turn.available, turn.checkpointId != selected?.checkpointId else { return }
    model.navigate(.sessionGit(id: workspace.sessionId, view: .timeline(turn: turn.checkpointId)))
  }

  private func loadDiff() async {
    guard let turn = selected, turn.available else { return }
    workspace.timelineDiff.scope = .turn(turn.sessionTurn)
    await workspace.timelineDiff.load()
  }

  private struct DiffKey: Hashable {
    let turn: String?
    let generation: Int
  }
}

/// Asks before the files move, saying what stays and that it can be undone.
private struct RestoreConfirmation: ViewModifier {
  let vm: TimelineModel

  func body(content: Content) -> some View {
    content.alert(
      vm.confirming.map { "Restore to the end of turn \($0.number)?" } ?? "",
      isPresented: Binding(get: { vm.confirming != nil }, set: { if !$0 { vm.confirming = nil } }),
      presenting: vm.confirming
    ) { turn in
      Button("Restore") {
        vm.confirming = nil
        Task { await vm.restore(turn) }
      }
      Button("Cancel", role: .cancel) { vm.confirming = nil }
    } message: { _ in
      Text(
        "The session's files go back to how they were when this turn ended. The conversation stays as it is, "
          + "and you can undo the restore from the timeline.")
    }
  }
}
