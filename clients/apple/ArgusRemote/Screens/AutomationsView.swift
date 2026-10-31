import ArgusUI
import SwiftUI

/// The connected computer's automations, and what they have been doing.
///
/// Automations are the one thing in Argus that happens while nobody is
/// looking, which is exactly what you want to check from a phone.
struct AutomationsView: View {
  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @Environment(Router.self) private var router
  @Environment(AutomationsStore.self) private var store

  /// Folded so the runs don't push the automations themselves off screen.
  private static let recentRuns = 3
  @State private var showingAllRuns = false

  var body: some View {
    List {
      if let error = store.error {
        Banner(text: error, tone: .danger).listRowBackground(Color.clear)
      }

      if !store.loaded {
        Loading(label: "Reading automations…")
          .listRowBackground(Color.clear)
      } else if !store.automations.isEmpty || !store.runs.isEmpty {
        if !store.automations.isEmpty {
          Section {
            ForEach(store.automations) { automation in
              let latest = store.runs(for: automation.id).first
              NavigationLink(
                value: Route.automation(id: automation.id, label: automation.name)
              ) {
                AutomationRow(automation: automation, lastRun: latest?.status, lastRunAt: latest?.startedAt)
              }
              .swipeActions(edge: .trailing) {
                if host.hasControl, latest?.isActive != true {
                  Button {
                    Task { await store.runNow(automationId: automation.id) }
                  } label: {
                    Label("Run now", systemImage: Icon.play)
                  }
                  .tint(theme.accent)
                  .disabled(store.triggering.contains(automation.id) || host.connection != .ready)
                }
              }
            }
          } header: {
            // Alone on the screen it would only repeat the title.
            if !store.runs.isEmpty { Text("Automations") }
          }
        }
        if !store.runs.isEmpty {
          Section("Recent runs") {
            ForEach(showingAllRuns ? store.runs : Array(store.runs.prefix(Self.recentRuns))) { run in
              NavigationLink(value: Route.run(id: run.id, label: run.automationName)) {
                RunRow(run: run, showName: true)
              }
            }
            if store.runs.count > Self.recentRuns {
              Button(showingAllRuns ? "Show fewer" : "See all \(store.runs.count)") {
                withAnimation { showingAllRuns.toggle() }
              }
            }
          }
        }
      }
    }
    .emptyState(when: store.loaded && store.automations.isEmpty && store.runs.isEmpty) {
      EmptyState(
        icon: Icon.automations,
        title: "No automations",
        body: "Use + to run a playbook once, or to set one on a schedule.")
    }
    .navigationTitle("Automations")
    .toolbar {
      if host.hasControl {
        ToolbarItem(placement: .topBarTrailing) {
          Menu {
            NavigationLink(value: Route.quickRun) {
              Label("Quick run", systemImage: Icon.play)
            }
            NavigationLink(value: Route.automationEditor(id: nil, label: "New automation")) {
              Label("New automation", systemImage: Icon.clock)
            }
            NavigationLink(value: Route.describeAutomation) {
              Label("Describe it", systemImage: Icon.agent)
            }
          } label: {
            Label("New", systemImage: Icon.plus)
          }
        }
      }
    }
    .refreshable { await store.refresh() }
    .liveRefresh(enabled: host.connection == .ready) { await store.refresh() }
  }
}
