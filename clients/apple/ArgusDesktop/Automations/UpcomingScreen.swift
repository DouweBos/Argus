import ArgusCore
import ArgusUI
import SwiftUI

/// `/automations/upcoming`: every automation and teammate duty's next run,
/// soonest first, and what each one is waiting on.
struct UpcomingScreen: View {
  @Environment(DesktopModel.self) private var model
  @Environment(AutomationsStore.self) private var store
  @Environment(\.theme) private var theme
  @State private var selection: String?

  var body: some View {
    Group {
      if let runs = store.upcoming {
        if runs.isEmpty {
          EmptyState(
            icon: "calendar.badge.clock", title: "Nothing scheduled",
            body: "Automations and teammate duties on a schedule show up here, soonest first.")
        } else {
          table(runs)
        }
      } else {
        ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .navigationTitle("Upcoming")
    .navigationSubtitle(store.upcoming.map { AutomationText.plural($0.count, "run") } ?? "")
    .toolbar {
      ToolbarItem {
        Button { Task { await store.loadUpcoming() } } label: {
          Label("Refresh", systemImage: "arrow.clockwise")
        }
      }
    }
    .task { await store.loadUpcoming(viewed: true) }
    // Runs starting and finishing change what each one waits on.
    .onChange(of: store.runs.map(\.status)) { Task { await store.loadUpcoming() } }
  }

  private func table(_ runs: [ArgusProtocol.UpcomingRun]) -> some View {
    Table(runs, selection: $selection) {
      TableColumn("Name") { run in
        Button { open(run) } label: {
          VStack(alignment: .leading, spacing: 2) {
            Text(run.name).fontWeight(.medium)
            Text(Labels.upcomingSubtitle(run)).font(.scaled(.caption)).foregroundStyle(.secondary)
          }
          .contentShape(.rect)
        }
        .buttonStyle(.argusPlain)
        .accessibilityLabel(run.name)
      }
      TableColumn("Next run") { Text(Labels.upcomingWhen($0)) }.width(min: 150, ideal: 170)
      TableColumn("Waiting on") { run in
        if let wait = Labels.upcomingWaitLabel(run) {
          HStack(spacing: 6) {
            StatusDot(tone: UpcomingRunRow.tone(run))
            Text(wait).foregroundStyle(UpcomingRunRow.tone(run).color(theme)).lineLimit(2)
          }
        } else {
          Text("On schedule").foregroundStyle(.secondary)
        }
      }
      .width(min: 220, ideal: 300)
    }
    .alternatingRowBackgrounds(.disabled)
    .contextMenu(forSelectionType: String.self) { _ in } primaryAction: { ids in
      if let id = ids.first { model.navigate(.automation(id: id, runId: nil)) }
    }
  }

  private func open(_ run: ArgusProtocol.UpcomingRun) {
    model.navigate(.automation(id: run.automationId, runId: nil))
  }
}

extension ArgusProtocol.UpcomingRun: @retroactive Identifiable {
  public var id: String { automationId }
}
