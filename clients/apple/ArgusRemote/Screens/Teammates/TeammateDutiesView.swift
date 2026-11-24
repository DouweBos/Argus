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
  @State private var promoting = false

  private static let recentRuns = 5

  /// The automation list's copy when it has one, so running state stays live.
  private var duties: [RemoteAutomation] {
    (store.detailById[teammateId]?.duties ?? []).compactMap { duty in
      automations.automations.first { $0.id == duty.id } ?? RemoteAutomation(wire: duty)
    }
  }

  private var standalone: [RemoteAutomation] {
    automations.automations.filter { $0.teammateId == nil }.sorted {
      $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
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
        body: host.hasControl
          ? "It only works when you talk to it. Add an automation to give it a duty."
          : "It only works when you talk to it.")
    }
    .overlay { if !loaded && duties.isEmpty { Loading(label: "Reading duties") } }
    .navigationTitle("Duties")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      if host.hasControl {
        ToolbarItem(placement: .topBarTrailing) { addMenu }
      }
    }
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

  /// A standalone automation becomes a duty; its memories move with it.
  private var addMenu: some View {
    Menu {
      Section("Add automation") {
        ForEach(standalone) { automation in
          Button(automation.name) { promote(automation.id) }
        }
      }
      if standalone.isEmpty {
        Text("Every automation already belongs to a teammate")
      }
    } label: {
      Label("Add automation", systemImage: Icon.plus)
    }
    .disabled(promoting || host.connection != .ready)
  }

  private func promote(_ automationId: String) {
    promoting = true
    Task {
      if await store.promote(automationId: automationId, into: teammateId) != nil {
        await store.loadDetail(id: teammateId)
        await automations.refresh()
      }
      promoting = false
    }
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
