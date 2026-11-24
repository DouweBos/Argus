import ArgusUI
import SwiftUI

/// What a teammate does on its own: its duties, which are ordinary
/// automations, and their runs together. A duty opens the automation screen.
struct TeammateDutiesView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(TeammatesStore.self) private var store
  @Environment(AutomationsStore.self) private var automations

  let teammateId: String

  @State private var loaded = false
  @State private var removing: RemoteAutomation?

  private static let recentRuns = 5

  /// The automation list's copy when it has one, so running state stays live.
  private var duties: [RemoteAutomation] {
    (store.detailById[teammateId]?.duties ?? []).compactMap { duty in
      automations.automations.first { $0.id == duty.id } ?? RemoteAutomation(wire: duty)
    }
  }

  private var runs: [RemoteAutomationRun] {
    let ids = Set(duties.map(\.id))
    return automations.runs.filter { ids.contains($0.automationId) }
  }

  var body: some View {
    List {
      if !duties.isEmpty {
        Section {
          ForEach(duties) { duty in
            let latest = automations.runs(for: duty.id).first
            NavigationLink(value: Route.automation(id: duty.id, label: duty.name)) {
              AutomationRow(automation: duty, lastRun: latest?.status, lastRunAt: latest?.startedAt)
            }
            .swipeActions(edge: .trailing) {
              if host.hasControl { removeButton(duty) }
            }
            .contextMenu {
              if host.hasControl { removeButton(duty) }
            }
          }
        } footer: {
          if host.hasControl {
            Text("Swipe a duty to make it a standalone automation. Its memories stay with the teammate.")
          }
        }
      }
      if !runs.isEmpty {
        Section("Recent runs") {
          ForEach(runs.prefix(Self.recentRuns)) { run in
            NavigationLink(value: Route.run(id: run.id, label: run.automationName)) {
              RunRow(run: run, showName: true)
            }
          }
        }
      }
    }
    .emptyState(when: loaded && duties.isEmpty) {
      EmptyState(
        icon: Icon.automations, title: "No duties",
        body: "It only works when you talk to it. Promote an automation on the Mac to give it one.")
    }
    .overlay { if !loaded && duties.isEmpty { Loading(label: "Reading duties") } }
    .navigationTitle("Duties")
    .navigationBarTitleDisplayMode(.inline)
    .confirmationDialog(
      "Remove \(removing?.name ?? "this duty") from the teammate?",
      isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }),
      titleVisibility: .visible, presenting: removing
    ) { duty in
      Button("Remove from teammate") {
        Task { await store.removeDuty(teammateId: teammateId, automationId: duty.id) }
      }
      Button("Cancel", role: .cancel) {}
    } message: { _ in
      Text("It keeps running as a standalone automation.")
    }
    .task {
      await store.loadDetail(id: teammateId)
      loaded = true
    }
    .refreshable {
      await store.loadDetail(id: teammateId)
      await automations.refresh()
    }
    .liveRefresh(enabled: host.connection == .ready) { await automations.refresh() }
  }

  private func removeButton(_ duty: RemoteAutomation) -> some View {
    Button {
      removing = duty
    } label: {
      Label("Remove from teammate", systemImage: Icon.close)
    }
    .tint(theme.textSecondary)
  }
}
