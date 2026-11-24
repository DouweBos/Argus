import ArgusUI
import SwiftUI

/// The connected computer's teammates: named agents that own automations and
/// share one memory. Under the Automations tab, since that's what they run.
struct TeammatesView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(TeammatesStore.self) private var store

  var body: some View {
    List {
      if store.phase.showsContent {
        if let error = store.error {
          Banner(text: error, tone: .danger).listRowBackground(Color.clear)
        }
        Section {
          ForEach(store.summaries) { summary in
            NavigationLink(value: Route.teammate(id: summary.teammate.id, page: .chat(threadId: nil))) {
              TeammateRow(summary: summary)
            }
            .swipeActions(edge: .trailing) {
              if host.hasControl { enableButton(summary.teammate) }
            }
            .contextMenu {
              if host.hasControl { enableButton(summary.teammate) }
              NavigationLink(value: Route.teammate(id: summary.teammate.id, page: .profile)) {
                Label("Profile", systemImage: Icon.person)
              }
            }
          }
        }
      }
    }
    .loadPhase(
      store.phase, loading: "Reading teammates", failedTitle: "Teammates unavailable",
      retry: { await store.refresh() }
    ) {
      EmptyState(
        icon: Icon.person,
        title: "No teammates",
        body: host.hasControl
          ? "A teammate is a named agent you can talk to, with its own memory and duties. Use + to pick one."
          : "A teammate is a named agent you can talk to, with its own memory and duties.")
    }
    .navigationTitle("Teammates")
    .toolbar {
      if host.hasControl {
        ToolbarItem(placement: .topBarTrailing) {
          NavigationLink(value: Route.teammateGallery) {
            Label("New Teammate", systemImage: Icon.plus)
          }
        }
      }
    }
    .refreshable { await store.refresh() }
    .liveRefresh(enabled: host.connection == .ready) { await store.refresh() }
  }

  /// Paused stops its duties and surfaces; talking to it directly still works.
  private func enableButton(_ teammate: TeammatesStore.Teammate) -> some View {
    Button {
      Task { await store.setEnabled(teammate.id, !teammate.enabled) }
    } label: {
      teammate.enabled
        ? Label("Pause", systemImage: Icon.playPause) : Label("Resume", systemImage: Icon.play)
    }
    .tint(teammate.enabled ? theme.textSecondary : theme.accent)
    .disabled(host.connection != .ready)
  }
}
