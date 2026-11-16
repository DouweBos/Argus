import ArgusCore
import ArgusUI
import SwiftUI

/// `/inbox` — what Argus wants from you, grouped by what you would do about
/// it: a pending decision outranks a report, which outranks work in flight,
/// which outranks a run that already failed.
struct InboxScreen: View {
  @Environment(DesktopModel.self) private var model
  @Environment(HostStore.self) private var host
  /// From the route: which automation's and project's items to show.
  let filter: InboxFilter
  /// The failure and cleared windows are relative to now, so they move while the screen is open.
  @State private var now = Date()

  private var inbox: InboxStore { model.inbox }

  private var allItems: InboxItems {
    inbox.items(sessionIds: Set(host.sessionsByRepo.values.joined().map(\.id)), now: now)
  }

  var body: some View {
    let all = allItems
    let items = all.filtered(filter)
    let phase = LoadPhase(loaded: inbox.loaded, error: inbox.error, isEmpty: items.isEmpty)
    Group {
      switch phase {
      case .loading: ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
      case .failed(let error):
        EmptyState(icon: "exclamationmark.triangle", title: "Inbox unavailable", body: error) {
          Button("Try Again") { Task { await inbox.refresh() } }
        }
      case .empty: empty
      case .content: sections(items)
      }
    }
    .safeAreaInset(edge: .top) {
      if phase.showsContent, let error = inbox.error {
        Banner(text: error, tone: .danger).padding([.horizontal, .top])
      }
    }
    .toolbar {
      if !all.isEmpty || !filter.isEmpty {
        ToolbarItem {
          InboxFilterMenu(
            options: all.filterOptions(selected: filter) { id in
              model.automations.automations.first { $0.id == id }?.name
            },
            filter: filter
          ) { next, field in
            MacTelemetry.capture(.inboxFiltered(by: field))
            model.navigate(.inbox(next))
          }
        }
      }
    }
    .navigationTitle("Inbox")
    .navigationSubtitle(
      items.pending.isEmpty
        ? "No decisions waiting"
        : "\(AutomationText.plural(items.pending.count, "decision")) waiting")
    .task { await inbox.refresh() }
    .task {
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(60))
        now = Date()
      }
    }
  }

  @ViewBuilder private var empty: some View {
    if filter.isEmpty { quiet } else {
      EmptyState(icon: "tray", title: "Nothing here", body: "Nothing in the inbox matches this filter.") {
        Button("Clear Filters") {
          MacTelemetry.capture(.inboxFiltered(by: .clear))
          model.navigate(.inbox())
        }
      }
    }
  }

  private var quiet: some View {
    let none = model.automations.automations.isEmpty
    return EmptyState(
      icon: "tray", title: "Nothing needs you",
      body:
        none
        ? "Turn on an automation and whatever it finds — issues to pick up, work it has already "
        + "started — shows up here."
        : "Your automations have nothing waiting on you. This is what a quiet inbox looks like."
    ) {
      Button(none ? "Set Up an Automation" : "Automations") { model.navigate(.automations) }
    }
  }

  private func sections(_ items: InboxItems) -> some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        group("Decide", items.pending.isEmpty ? nil : "\(items.pending.count) waiting") {
          ForEach(items.pending, id: \.id) { ProposalCardView(proposal: $0, openable: true) }
        }
        group("New reports", count(items.reports)) {
          ForEach(items.reports, id: \.id) { ReportRow(run: $0) }
        }
        group("Argus is on it", count(items.started)) {
          ForEach(items.started, id: \.id) { StartedRow(proposal: $0) }
        }
        group("Needs a look", count(items.failed)) {
          ForEach(items.failed, id: \.id) { FailedRow(run: $0) }
        }
        group("Argus cleared these", count(items.cleared)) {
          ForEach(items.cleared, id: \.id) { ClearedRow(proposal: $0) }
        }
      }
      .padding(24)
      .frame(maxWidth: 820, alignment: .leading)
      .frame(maxWidth: .infinity)
    }
  }

  private func count<T>(_ list: [T]) -> String? {
    list.isEmpty ? nil : "\(list.count)"
  }

  /// Only groups with something in them are shown.
  @ViewBuilder
  private func group<Content: View>(
    _ title: String, _ meta: String?, @ViewBuilder content: () -> Content
  ) -> some View {
    if let meta {
      VStack(alignment: .leading, spacing: 8) {
        HStack {
          Text(title).font(.scaled(.title3).weight(.semibold))
          Text(meta).foregroundStyle(.secondary)
        }
        content()
      }
    }
  }
}
