import ArgusKit
import SwiftUI

/// The connected computer's automations, and what they have been doing.
///
/// Automations are the one thing in Argus that happens while nobody is
/// looking, which is exactly what you want to check from a phone.
struct AutomationsView: View {
  @Environment(AppStore.self) private var app
  @Environment(Router.self) private var router
  @Environment(AutomationsStore.self) private var store

  /// Enough to see what fired overnight without scrolling past the automations.
  private static let recentRuns = 8

  var body: some View {
    List {
      if let error = store.error {
        Banner(text: error, tone: .danger).listRowBackground(Color.clear)
      }

      if !store.loaded {
        Loading(label: "Reading automations…")
          .listRowBackground(Color.clear)
      } else if store.automations.isEmpty && store.runs.isEmpty {
        EmptyState(
          icon: Icon.clock,
          title: "No automations",
          body: "Create one in Argus on your computer and it'll show up here.")
        .listRowBackground(Color.clear)
      } else {
        let recent = Array(store.runs.prefix(Self.recentRuns))
        if !recent.isEmpty {
          Section("Recent runs") {
            ForEach(recent) { run in
              NavigationLink(value: Route.run(id: run.id, label: run.automationName)) {
                RunRow(run: run, showName: true)
              }
            }
          }
        }
        if !store.automations.isEmpty {
          Section("Automations") {
            ForEach(store.automations) { automation in
              NavigationLink(
                value: Route.automation(id: automation.id, label: automation.name)
              ) {
                AutomationRow(automation: automation)
              }
            }
          }
        }
      }
    }
    .navigationTitle("Automations")
    .refreshable { await store.refresh() }
    .liveRefresh(enabled: app.connection == .ready) { await store.refresh() }
  }
}
