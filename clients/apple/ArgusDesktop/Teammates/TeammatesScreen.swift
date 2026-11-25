import ArgusCore
import ArgusUI
import SwiftUI

/// `/teammates`: the named agents on this host, listed like conversations —
/// what you last talked about, whether one is busy, and when.
struct TeammatesScreen: View {
  @Environment(DesktopModel.self) private var model
  @Environment(TeammatesStore.self) private var store

  var body: some View {
    let phase = store.phase
    Group {
      switch phase {
      case .loading: ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
      case .failed(let error):
        EmptyState(icon: "exclamationmark.triangle", title: "Teammates unavailable", body: error) {
          Button("Try Again") { Task { await store.refresh() } }
        }
      case .empty: empty
      case .content: table
      }
    }
    .safeAreaInset(edge: .top) {
      if phase.showsContent, let error = store.error {
        Banner(text: error, tone: .danger).padding([.horizontal, .top])
      }
    }
    .navigationTitle("Teammates")
    .navigationSubtitle(AutomationText.plural(store.summaries.count, "teammate"))
    .toolbar {
      ToolbarItem {
        Button { model.navigate(.teammateGallery) } label: { Label("New Teammate", systemImage: "plus") }
          .labelStyle(.titleAndIcon)
      }
    }
    .task { await store.refresh() }
  }

  private var empty: some View {
    EmptyState(
      icon: Icon.teammates, title: "No teammates yet",
      body:
        "A teammate is an agent with a name, a memory and duties of its own. It runs its duties "
        + "on their triggers, and you can talk to it whenever you like."
    ) {
      Button("Browse Teammates") { model.navigate(.teammateGallery) }
    }
  }

  /// Read like a list of conversations: open one to talk, pause from its menu.
  private var table: some View {
    List(store.summaries) { summary in
      Button { open(summary.teammate.id) } label: {
        TeammateRow(summary: summary).padding(.vertical, 4).contentShape(.rect)
      }
      .buttonStyle(.argusPlain)
      .accessibilityLabel(summary.teammate.name)
      .contextMenu { menu(summary.teammate) }
    }
    .listStyle(.inset)
    .alternatingRowBackgrounds(.disabled)
  }

  @ViewBuilder
  private func menu(_ teammate: TeammatesStore.Teammate) -> some View {
    Button("Open Conversation") { open(teammate.id) }
    Divider()
    Button("Profile") { model.navigate(.teammate(id: teammate.id, page: .profile)) }
    Button("Duties") { model.navigate(.teammate(id: teammate.id, page: .duties)) }
    Button("Memory") { model.navigate(.teammate(id: teammate.id, page: .memory)) }
    Divider()
    Button(teammate.enabled ? "Pause" : "Resume") {
      Task { await store.setEnabled(teammate.id, !teammate.enabled) }
    }
  }

  private func open(_ id: String) {
    model.navigate(.teammate(id: id))
  }
}
