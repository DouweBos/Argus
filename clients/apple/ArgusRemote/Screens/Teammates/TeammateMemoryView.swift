import ArgusUI
import SwiftUI

/// What a teammate has learned: one memory every duty and conversation of
/// it reads. Shown as an automation's memories are, one card each.
struct TeammateMemoryView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(TeammatesStore.self) private var store

  let teammateId: String

  /// The memory sheet: `.some(nil)` adds one, `nil` is closed.
  @State private var openMemory: MemorySelection?

  private struct MemorySelection: Identifiable {
    let memory: RemoteAutomationMemory?
    var id: String { memory?.name ?? "+new" }
  }

  var body: some View {
    Screen {
      if let error = store.error {
        Banner(text: error, tone: .danger)
      }
      if let items = store.memoriesById[teammateId] {
        if items.isEmpty {
          EmptyState(
            icon: "brain", title: "Nothing yet",
            body: "Its duties and conversations save what they learn here, so the next one doesn't start from scratch.")
        } else {
          SectionHeader(title: "Memories", count: items.count)
          ForEach(items) { memory in
            Card(onTap: { openMemory = MemorySelection(memory: memory) }) {
              HStack(spacing: 8) {
                Text(memory.name)
                  .font(.footnote.weight(.semibold).monospaced())
                  .foregroundStyle(theme.text)
                Spacer(minLength: 6)
                Badge(label: memory.type.rawValue)
              }
              MutedText(memory.description, lineLimit: 2)
            }
          }
        }
      } else {
        Loading(label: "Reading memory")
      }
    }
    .navigationTitle("Memory")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      if host.hasControl {
        ToolbarItem(placement: .topBarTrailing) {
          Button {
            openMemory = MemorySelection(memory: nil)
          } label: {
            Label("Add memory", systemImage: Icon.plus)
          }
          .disabled(host.connection != .ready)
        }
      }
    }
    .liveRefresh(enabled: host.connection == .ready) { await store.loadMemories(teammateId: teammateId) }
    .sheet(item: $openMemory) { selection in
      TeammateMemoryEditorSheet(teammateId: teammateId, memory: selection.memory)
    }
  }
}
