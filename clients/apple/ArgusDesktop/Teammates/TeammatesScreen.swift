import ArgusCore
import ArgusUI
import SwiftUI

/// `/teammates`: the named agents on this host — who they are, their duties,
/// when they last did something, and their switch.
struct TeammatesScreen: View {
  @Environment(DesktopModel.self) private var model
  @Environment(TeammatesStore.self) private var store
  @State private var selection: String?

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

  private var table: some View {
    Table(store.summaries, selection: $selection) {
      TableColumn("") { summary in
        Toggle(
          "",
          isOn: Binding(
            get: { summary.teammate.enabled },
            set: { on in Task { await store.setEnabled(summary.teammate.id, on) } })
        )
        .toggleStyle(.argusSwitch).controlSize(.mini).labelsHidden()
        .help(summary.teammate.enabled ? "Enabled" : "Paused")
      }
      .width(44)
      TableColumn("Name") { summary in
        Button { open(summary.teammate.id) } label: {
          HStack(spacing: 10) {
            TeammateAvatar(teammate: summary.teammate, size: 28)
            VStack(alignment: .leading, spacing: 2) {
              HStack(spacing: 6) {
                Text(summary.teammate.name).fontWeight(.medium)
                Text("@\(summary.teammate.handle)").foregroundStyle(.secondary)
              }
              if !summary.teammate.tagline.isEmpty {
                Text(summary.teammate.tagline).font(.scaled(.caption)).foregroundStyle(.secondary).lineLimit(1)
              }
            }
          }
          .contentShape(.rect)
        }
        .buttonStyle(.argusPlain)
        .accessibilityLabel(summary.teammate.name)
      }
      TableColumn("Duties") { summary in
        Text(summary.dutyCount == 1 ? "1 duty" : "\(Int(summary.dutyCount)) duties").foregroundStyle(.secondary)
      }
      .width(80)
      TableColumn("Last run") { summary in
        HStack(spacing: 6) {
          if summary.hasUnreadReport { StatusDot(tone: .accent, accessibilityLabel: "New report") }
          Text(summary.lastRunAt.map { Labels.timeAgo($0) } ?? "Never").foregroundStyle(.secondary)
        }
      }
      .width(min: 120)
      TableColumn("") { summary in
        Button("Talk") { open(summary.teammate.id) }.controlSize(.small)
      }
      .width(70)
    }
    .alternatingRowBackgrounds(.disabled)
    .contextMenu(forSelectionType: String.self) { ids in
      if let id = ids.first {
        Button("Talk") { open(id) }
        Button("Profile") { model.navigate(.teammate(id: id, page: .profile)) }
        Button("Duties") { model.navigate(.teammate(id: id, page: .duties)) }
      }
    } primaryAction: { ids in
      if let id = ids.first { open(id) }
    }
  }

  private func open(_ id: String) {
    model.navigate(.teammate(id: id))
  }
}
