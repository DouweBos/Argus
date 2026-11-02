import ArgusUI
import SwiftUI

/// What one transcript table row shows: the loading strip above the history,
/// a message, a turn's folded work, or the foot (working indicator, tasks, the
/// decisions the agent waits on, queued and unsent messages).
enum TranscriptRow {
  case top(TopState)
  case segment(ToolGroups.Segment)
  case work(WorkLog)
  case footer(FooterState)

  struct TopState: Equatable {
    var hasOlder = false
    var loading = false
  }

  struct FooterState: Equatable {
    var pending: [RemoteToolCall] = []
    /// What else the foot draws from the store. A change re-measures the row:
    /// left at its old height, the hosted foot is centred in it and clipped.
    var working = false
    var lists: [Int] = []
  }

  /// A hosting view's root: the column, the pane's environment (AppKit hosting
  /// doesn't inherit it) and an identity, so a recycled view keeps no stale state.
  /// `onLayout` hears every size the row lays out at, during that layout pass:
  /// `onGeometryChange` reports a turn later, by when the cell may show another row.
  @MainActor
  static func root(
    _ row: TranscriptRow, id: String?, agentKey: String, model: TranscriptModel, selection: TranscriptSelection,
    environment: EnvironmentValues,
    onLayout: (@MainActor (CGSize) -> Void)? = nil
  ) -> AnyView {
    let laidOut = LaidOutSize(onLayout: onLayout) { content(row, agentKey: agentKey).readingColumn() }
      .fixedSize(horizontal: false, vertical: true)
      // A recycled row swaps in new content; nothing in it may animate that in.
      .transaction { if row.isContent { $0.disablesAnimations = true; $0.animation = nil } }
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
        .padding(.bottom, TranscriptRow.spacing)
    case .segment(let segment):
      // Turns fold work into `.work`; a run segment only arrives unfolded.
      VStack(alignment: .leading, spacing: TranscriptRow.spacing) {
        ForEach(segment.messages) { TranscriptMessageRow(agentKey: agentKey, message: $0, tip: true) }
      }
      .padding(.bottom, TranscriptRow.spacing)
    case .work(let log):
      TranscriptWorkLog(agentKey: agentKey, log: log).equatable()
        .padding(.bottom, TranscriptRow.spacing)
    case .footer(let state):
      TranscriptFooter(agentKey: agentKey, state: state)
    }
  }
}

extension TranscriptRow {
  /// Between one message (or work log) and the next.
  static let spacing: CGFloat = 18

  /// A message or work log, as opposed to the strips above and below them.
  var isContent: Bool {
    switch self {
    case .segment, .work: true
    case .top, .footer: false
    }
  }
}

/// Passes its content through, telling `onLayout` the size it was placed at.
private struct LaidOutSize: SwiftUI.Layout {
  let onLayout: (@MainActor (CGSize) -> Void)?

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    subviews.first?.sizeThatFits(proposal) ?? .zero
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    subviews.first?.place(at: bounds.origin, anchor: .topLeading, proposal: ProposedViewSize(bounds.size))
    guard let onLayout else { return }
    let size = bounds.size
    MainActor.assumeIsolated { onLayout(size) }
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
      // Queue adds still on their way to the host.
      let sending = host.sendingQueuedByAgent[agentKey] ?? []
      if !queued.isEmpty || !sending.isEmpty {
        SectionHeader(title: "Queued", count: queued.count + sending.count)
        ForEach(queued) { QueuedMessageCard(agentKey: agentKey, message: $0) }
        ForEach(sending) { QueuedMessageCard(agentKey: agentKey, message: $0, sending: true) }
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
