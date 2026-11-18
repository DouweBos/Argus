import ArgusUI
import SwiftUI

/// A session's versions, as the Mac's Timeline: one row per agent turn, newest
/// first, with the restores between them. A turn opens its diff in Changes;
/// with control, swipe or long-press one to put the files back to where it ended.
struct SessionTimelineView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host

  let sessionId: String
  let label: String

  @State private var timeline = SessionTimeline()
  @State private var loaded = false
  @State private var failure: String?
  @State private var working = false
  @State private var restoring: TimelineTurn?
  @State private var tracked = false

  var body: some View {
    List {
      if timeline.busy, host.hasControl, !timeline.turns.isEmpty {
        Section {
          Label("An agent is working. Restoring waits until it stops.", systemImage: Icon.agent)
            .font(.scaled(.footnote))
            .foregroundStyle(theme.textSecondary)
        }
      }
      Section {
        ForEach(timeline.entries) { entry in
          Group {
            switch entry {
            case .turn(let turn): turnRow(turn)
            case .restore(let restore): restoreRow(restore)
            }
          }
          // Separators start at the prompt column, past the turn number, whatever its width.
          .alignmentGuide(.listRowSeparatorLeading) { _ in 30 }
        }
      } footer: {
        if !timeline.turns.isEmpty {
          Text("Restoring puts back the files only; the conversation stays as it is.")
        }
      }
    }
    .disabled(working)
    .loadPhase(
      LoadPhase(loaded: loaded, error: failure, isEmpty: timeline.turns.isEmpty), loading: "Reading the timeline",
      failedTitle: "Couldn't load the timeline", retry: { await refresh() }
    ) {
      EmptyState(
        icon: Icon.timeline, title: "No turns yet",
        body: "Each prompt an agent runs in this session shows up here, with what it changed.")
    }
    .navigationTitle("Timeline · \(label)")
    .navigationBarTitleDisplayMode(.inline)
    .task { await refresh() }
    .refreshable { await refresh() }
    .liveRefresh(enabled: host.connection == .ready, every: .seconds(10)) { await refresh() }
    .confirmationDialog(
      restoring.map { "Restore to the end of turn \($0.number)?" } ?? "",
      isPresented: Binding(get: { restoring != nil }, set: { if !$0 { restoring = nil } }),
      titleVisibility: .visible, presenting: restoring
    ) { turn in
      Button("Restore to This Version") { restore(turn) }
      Button("Cancel", role: .cancel) {}
    } message: { turn in
      Text(
        "The session's files go back to how they were when turn \(turn.number) ended. The conversation stays as it is, and you can undo this right after."
      )
    }
  }

  @ViewBuilder
  private func turnRow(_ turn: TimelineTurn) -> some View {
    Group {
      if turn.available {
        StackLink(route: .turnChanges(sessionId: sessionId, label: label, checkpointId: turn.checkpointId)) {
          TimelineTurnRow(turn: turn, compact: false)
        }
      } else {
        TimelineTurnRow(turn: turn, compact: false)
      }
    }
    .contextMenu {
      if canRestore(turn) {
        Button("Restore to This Version", systemImage: Icon.restoreVersion) { restoring = turn }
      }
    }
    .swipeActions(edge: .leading) {
      if canRestore(turn) {
        Button("Restore", systemImage: Icon.restoreVersion) { restoring = turn }.tint(theme.accent)
      }
    }
  }

  private func restoreRow(_ restore: TimelineRestore) -> some View {
    TimelineRestoreRow(
      restore: restore,
      undo: restore.canUndo && host.hasControl && !timeline.busy ? { undo(restore) } : nil)
  }

  private func canRestore(_ turn: TimelineTurn) -> Bool {
    host.hasControl && turn.canRestore && !timeline.busy
  }

  private func restore(_ turn: TimelineTurn) {
    working = true
    Task {
      do {
        try await host.restoreTurn(sessionId: sessionId, checkpointId: turn.checkpointId)
      } catch {
        host.report(error, scope: "git:timeline")
      }
      await refresh()
      working = false
    }
  }

  private func undo(_ restore: TimelineRestore) {
    working = true
    Task {
      do {
        try await host.undoRestore(sessionId: sessionId, restoreId: restore.id)
      } catch {
        host.report(error, scope: "git:timeline")
      }
      await refresh()
      working = false
    }
  }

  private func refresh() async {
    do {
      let next = try await host.loadTimeline(sessionId: sessionId)
      guard !Task.isCancelled else { return }
      timeline = next
      failure = nil
      if !tracked {
        tracked = true
        host.trackTimelineOpened(turns: next.turns.count)
      }
    } catch where !HostStore.isQuiet(error) {
      failure = HostStore.describe(error)
    } catch {}
    loaded = true
  }
}
