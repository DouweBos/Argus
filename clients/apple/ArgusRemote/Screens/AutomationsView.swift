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
  @Environment(TeammatesStore.self) private var teammates

  /// Folded so the runs don't push the automations themselves off screen.
  private static let recentRuns = 3
  @State private var showingAllRuns = false

  var body: some View {
    let automations = store.standaloneAutomations
    let runs = store.standaloneRuns
    List {
      if phase.showsContent {
        if let error = store.error {
          Banner(text: error, tone: .danger).listRowBackground(Color.clear)
        }
        Section {
          if showsTeammates {
            NavigationLink(value: Route.teammates) { TeammatesEntryRow(summaries: teammates.summaries) }
          }
          NavigationLink(value: Route.upcomingRuns) {
            Label("Upcoming", systemImage: Icon.clock)
          }
        }
        if !automations.isEmpty {
          Section {
            ForEach(automations) { automation in
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
            if !runs.isEmpty { Text("Automations") }
          }
        }
        if !runs.isEmpty {
          Section("Recent runs") {
            ForEach(showingAllRuns ? runs : Array(runs.prefix(Self.recentRuns))) { run in
              NavigationLink(value: Route.run(id: run.id, label: run.automationName)) {
                RunRow(run: run, showName: true)
              }
            }
            if runs.count > Self.recentRuns {
              Button(showingAllRuns ? "Show fewer" : "See all \(runs.count)") {
                withAnimation { showingAllRuns.toggle() }
              }
            }
          }
        }
      }
    }
    .loadPhase(
      phase, loading: "Reading automations", failedTitle: "Automations unavailable",
      retry: { await store.refresh() }
    ) {
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
              Label("Quick Run", systemImage: Icon.play)
            }
            NavigationLink(value: Route.automationEditor(id: nil, label: "New Automation")) {
              Label("New Automation", systemImage: Icon.clock)
            }
            NavigationLink(value: Route.describeAutomation) {
              Label("Describe it", systemImage: Icon.agent)
            }
            if teammates.error == nil || !teammates.summaries.isEmpty {
              NavigationLink(value: Route.teammateGallery) {
                Label("New Teammate", systemImage: Icon.person)
              }
            }
          } label: {
            Label("New", systemImage: Icon.plus)
          }
        }
      }
    }
    .refreshable {
      await store.refresh()
      await teammates.refresh()
    }
    .liveRefresh(enabled: host.connection == .ready) {
      await store.refresh()
      await teammates.refresh()
    }
  }

  /// A computer too old to answer `teammates.list` gets no entry.
  private var showsTeammates: Bool {
    teammates.loaded && (teammates.error == nil || !teammates.summaries.isEmpty)
  }

  /// Duties don't count: they're listed under their teammate. The teammates
  /// entry does, so it stays reachable with no automations.
  private var phase: LoadPhase {
    var phase = store.phase
    if phase == .content && store.standaloneAutomations.isEmpty && store.standaloneRuns.isEmpty { phase = .empty }
    return phase == .empty && showsTeammates ? .content : phase
  }
}

/// The way into Teammates from the Automations tab: who is on the team, at a glance.
private struct TeammatesEntryRow: View {
  @Environment(\.theme) private var theme
  let summaries: [TeammatesStore.Summary]

  var body: some View {
    HStack(spacing: 10) {
      faces
      VStack(alignment: .leading, spacing: 2) {
        Text("Teammates").lineLimit(1)
        Text(subtitle).font(.scaled(.footnote)).foregroundStyle(.secondary).lineLimit(1)
      }
      Spacer(minLength: 6)
      if summaries.contains(where: \.hasUnreadReport) {
        StatusDot(tone: .accent, accessibilityLabel: "New report")
      }
    }
  }

  @ViewBuilder
  private var faces: some View {
    let shown = summaries.filter(\.teammate.enabled).prefix(3)
    if shown.isEmpty {
      Image(systemName: Icon.person)
        .font(.scaled(size: 14, weight: .semibold))
        .foregroundStyle(theme.accent)
        .frame(width: 30, height: 30)
        .background(theme.accent.opacity(0.15), in: .circle)
    } else {
      HStack(spacing: -10) {
        ForEach(Array(shown)) { summary in
          TeammateAvatar(teammate: summary.teammate, size: 30)
            .background(Circle().fill(theme.bgSecondary).padding(-2))
        }
      }
    }
  }

  private var subtitle: String {
    guard !summaries.isEmpty else { return "Named agents with their own memory and duties" }
    let active = summaries.filter(\.teammate.enabled).count
    let count = summaries.count == 1 ? "1 teammate" : "\(summaries.count) teammates"
    return active == summaries.count ? count : "\(count) · \(summaries.count - active) paused"
  }
}

/// `/automations/upcoming`: every automation and duty's next run, soonest
/// first, with what each is waiting on.
struct UpcomingView: View {
  @Environment(AutomationsStore.self) private var store

  var body: some View {
    let runs = store.upcoming ?? []
    List {
      ForEach(runs, id: \.automationId) { run in
        NavigationLink(value: Route.automation(id: run.automationId, label: run.name)) {
          UpcomingRunRow(run: run)
        }
      }
    }
    .overlay {
      if store.upcoming == nil {
        Loading(label: "Reading the schedule")
      } else if runs.isEmpty {
        EmptyState(
          icon: Icon.clock, title: "Nothing scheduled",
          body: "Automations and teammate duties on a schedule show up here.")
      }
    }
    .navigationTitle("Upcoming")
    .task { await store.loadUpcoming(viewed: true) }
    .refreshable { await store.loadUpcoming() }
  }
}
