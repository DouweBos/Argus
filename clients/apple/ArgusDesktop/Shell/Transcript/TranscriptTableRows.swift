import ArgusUI
import SwiftUI

/// What one transcript table row shows: the loading strip above the history,
/// a message or folded tool run, or the foot (working indicator, tasks, the
/// decisions the agent waits on, queued and unsent messages).
enum TranscriptRow {
  case top(TopState)
  case segment(ToolGroups.Segment)
  case footer(FooterState)

  struct TopState: Equatable {
    var hasOlder = false
    var loading = false
  }

  struct FooterState: Equatable {
    var pending: [RemoteToolCall] = []
    var showEmpty = false
  }

  /// A hosting view's root: the column, the pane's environment (AppKit hosting
  /// doesn't inherit it) and an identity, so a recycled view keeps no stale state.
  /// `onHeight` hears a row that resizes itself (an image landing, a card opening).
  @MainActor
  static func root(
    _ row: TranscriptRow, id: String?, agentKey: String, model: TranscriptModel, selection: TranscriptSelection,
    environment: EnvironmentValues,
    onHeight: ((CGFloat) -> Void)? = nil
  ) -> AnyView {
    let laidOut = content(row, agentKey: agentKey)
      .padding(.horizontal, 20)
      .frame(maxWidth: 920, alignment: .leading)
      .frame(maxWidth: .infinity)
      .fixedSize(horizontal: false, vertical: true)
      .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { onHeight?($0) }
      // A recycled row swaps in new content; nothing in it may animate that in.
      .transaction { if case .segment = row { $0.disablesAnimations = true; $0.animation = nil } }
    // No identity for measuring: the sizer keeps no state, and diffing one row
    // into the next is far cheaper than building a graph per row.
    let rooted = id.map { AnyView(laidOut.id($0)) } ?? AnyView(laidOut)
    return AnyView(
      rooted
        .environment(\.toolCardExpansion, model.toolCards)
        .environment(\.transcriptSelection, selection)
        .environment(\.self, environment))
  }

  @MainActor @ViewBuilder
  private static func content(_ row: TranscriptRow, agentKey: String) -> some View {
    switch row {
    case .top(let state):
      TranscriptTopRow(state: state)
    case .segment(.single(let message)):
      TranscriptMessageRow(agentKey: agentKey, message: message).equatable()
        .padding(.bottom, 14)
    case .segment(let segment):
      TranscriptToolGroup(agentKey: agentKey, id: segment.id, messages: segment.messages).equatable()
        .padding(.bottom, 14)
    case .footer(let state):
      TranscriptFooter(agentKey: agentKey, state: state)
    }
  }
}

/// The space above the first row; while older history is coming, a spinner.
private struct TranscriptTopRow: View {
  let state: TranscriptRow.TopState

  var body: some View {
    HStack(spacing: 8) {
      Spacer()
      if state.loading {
        ProgressView().controlSize(.small)
        MutedText("Loading earlier messages…")
      }
      Spacer()
    }
    .frame(height: state.hasOlder ? 28 : 0)
    .padding(.top, 16)
    .padding(.bottom, state.hasOlder ? 14 : 0)
  }
}

private struct TranscriptFooter: View {
  @Environment(HostStore.self) private var host
  let agentKey: String
  let state: TranscriptRow.FooterState

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      if state.showEmpty {
        EmptyState(icon: Icon.agent, title: "Nothing yet", body: "Send this agent a message to get it going.")
      }
      WorkingIndicator(
        status: host.statusByAgent[agentKey]?.status,
        pendingToolName: host.pendingToolByAgent[agentKey],
        pendingToolInput: nil,
        hasPendingPermission: !state.pending.isEmpty)

      if let tasks = host.tasksByAgent[agentKey], !tasks.isEmpty {
        TaskListView(
          title: "Tasks", items: tasks.map { ($0.activeForm ?? $0.subject, $0.status, $0.owner) })
      }
      if let todos = host.todosByAgent[agentKey], !todos.isEmpty {
        TaskListView(title: "Todos", items: todos.map { ($0.activeForm ?? $0.content, $0.status, nil) })
      }

      TranscriptPrompts(agentKey: agentKey, pending: state.pending)

      let queued = host.queuedByAgent[agentKey] ?? []
      if !queued.isEmpty {
        SectionHeader(title: "Queued", count: queued.count)
        ForEach(queued) { QueuedMessageCard(agentKey: agentKey, message: $0) }
      }
      let failed = host.failedByAgent[agentKey] ?? []
      if !failed.isEmpty {
        SectionHeader(title: "Not sent", count: failed.count)
        ForEach(failed) { FailedSendCard(agentKey: agentKey, item: $0) }
      }
    }
    .padding(.bottom, 16)
  }
}
