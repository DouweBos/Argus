import ArgusCore
import ArgusUI
import SwiftUI

/// One run in a history list: status, when, why, how long and what it cost —
/// with Cancel while it runs and Delete once it has finished.
struct RunHistoryRow: View {
  @Environment(\.theme) private var theme
  @Environment(AutomationsStore.self) private var store
  let run: RemoteAutomationRun
  let title: String
  let open: () -> Void
  @State private var confirmingDelete = false

  var body: some View {
    HStack(spacing: 10) {
      Circle().fill(run.unreadReport ? theme.accent : .clear).frame(width: 6, height: 6)
      Badge(label: run.status.rawValue, tone: run.status.tone)
      Button(action: open) {
        VStack(alignment: .leading, spacing: 2) {
          Text(AutomationText.timestamp(run.startedAt))
          Text(title).font(.caption).foregroundStyle(.secondary).lineLimit(1)
          if let error = run.error, !error.isEmpty {
            Text(error).font(.caption).foregroundStyle(theme.error).lineLimit(2)
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(.rect)
      }
      .buttonStyle(.plain)
      Text(Labels.runDuration(run)).monospacedDigit().foregroundStyle(.secondary)
      Text(Labels.runCost(run)).monospacedDigit().foregroundStyle(.secondary).frame(width: 56, alignment: .trailing)
      if run.isActive {
        Button("Cancel") { Task { await store.cancelRun(id: run.id) } }
      } else {
        Button("Delete") { confirmingDelete = true }
      }
    }
    .confirmationDialog("Delete this run?", isPresented: $confirmingDelete) {
      Button("Delete Run", role: .destructive) { Task { await store.deleteRun(id: run.id) } }
      Button("Keep It", role: .cancel) {}
    } message: {
      Text("The run, its report and any proposals it raised are removed. This cannot be undone.")
    }
  }
}

/// What runs carried forward for the next one; each opens in the shared editor.
struct MemoriesSection: View {
  @Environment(AutomationsStore.self) private var store
  let automationId: String
  @State private var open: Selection?

  private struct Selection: Identifiable {
    let memory: RemoteAutomationMemory?
    var id: String { memory?.name ?? "+new" }
  }

  var body: some View {
    let memories = store.memoriesById[automationId] ?? []
    Section {
      if memories.isEmpty {
        Text("Nothing yet. Runs save what they learn here so the next one doesn't start from scratch.")
          .foregroundStyle(.secondary)
      }
      ForEach(memories) { memory in
        Button {
          open = Selection(memory: memory)
        } label: {
          HStack {
            VStack(alignment: .leading, spacing: 2) {
              Text(memory.name).font(.system(.body, design: .monospaced))
              Text(memory.description).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            Badge(label: memory.type.rawValue)
          }
          .contentShape(.rect)
        }
        .buttonStyle(.plain)
      }
    } header: {
      HStack {
        Text("Memories")
        Spacer()
        Button("Add Memory…") { open = Selection(memory: nil) }.controlSize(.small)
      }
    }
    .task { await store.loadMemories(automationId: automationId) }
    .sheet(item: $open) { selection in
      MemoryEditorSheet(automationId: automationId, memory: selection.memory)
        .frame(minWidth: 560, minHeight: 520)
    }
  }
}
