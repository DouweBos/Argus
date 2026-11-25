#if DEBUG
  import ArgusCore
  import ArgusKit
  import ArgusUI
  import SwiftUI

  /// Home, every agent and a project's sessions, over the Mac's home fixtures.
  enum HomeStories {
    static var all: [GalleryStory] {
      [
        GalleryStory("home/loaded", fixtures: GalleryFixtures.home, setup: load) { ProjectsView() },
        // The project cards alone, below the fold in `home/loaded`.
        GalleryStory("home/projects", fixtures: GalleryFixtures.home, setup: load) { ProjectsStory() },
        GalleryStory("home/empty", fixtures: GalleryFixtures.homeEmpty, setup: load) { ProjectsView() },
        GalleryStory("search/results", fixtures: searchFixtures, setup: loadSearch) { SearchView(query: "fix") },
        GalleryStory("search/empty", fixtures: searchFixtures, setup: loadSearch) { SearchView() },
        accountRemoved,
        GalleryStory("agents/overview", fixtures: GalleryFixtures.home, setup: load) { AllAgentsView() },
        GalleryStory("sessions/sidebar", fixtures: GalleryFixtures.home, setup: load) {
          ProjectView(repoRoot: GalleryFixtures.argusRoot, name: "Argus")
        },
        // The iPad's sidebar, at the width a split view gives it, against the Mac's `sessions/sidebar`.
        GalleryStory("sessions/sidebar/ipad", chrome: false, fixtures: GalleryFixtures.home, setup: load) {
          HStack(spacing: 0) {
            SessionSidebar().frame(width: 320)
            Spacer(minLength: 0)
          }
        },
        GalleryStory("sessions/agent-tabs", screen: false, chrome: false) { AgentTabsStory() },
        GalleryStory("sessions/snooze-sheet", fixtures: GalleryFixtures.home, setup: load) {
          NavigationStack { SnoozeUntilForm(session: GalleryFixtures.argusSession("s-long")) }
        },
        GalleryStory("sessions/archived", fixtures: GalleryFixtures.home, setup: load) { ArchivedSessionsScreen() },
        GalleryStory("sessions/note-sheet", fixtures: GalleryFixtures.home, setup: load) {
          NavigationStack { SessionNoteForm(session: GalleryFixtures.argusSession("s-long")) }
        },
        setup("sessions/setup/progress", "s-setup"),
        setup("sessions/setup/failed", "s-failed"),
        setup("sessions/delete/teardown", "s-teardown"),
        setup("sessions/delete/teardown-failed", "s-teardown-failed"),
        GalleryStory("sessions/stack/context-card", fixtures: GalleryFixtures.home, setup: load) {
          Screen {
            StackCard(sessionId: "s-stack-2", onNewSessionOnTop: {}, onChanged: {})
          }
        },
        GalleryStory("sessions/stack/new-sheet", fixtures: GalleryFixtures.home, setup: load) {
          StackedSessionSheet(parent: GalleryFixtures.argusSession("s-stack-2")) { _ in }
        },
        GalleryStory("sessions/context-card", fixtures: GalleryFixtures.home, setup: load) {
          SessionDetailsView(
            session: GalleryFixtures.argusSession("s-long"), agentId: "a-perm", open: { _ in }, newAgent: {},
            deleted: {})
        },
        // The details sheet's session usage row, below the fold in `sessions/context-card`.
        GalleryStory("sessions/context-card-usage-limits", fixtures: GalleryFixtures.home, setup: load) {
          UsageLimitsSectionStory()
        },
      ]
    }

    private struct ProjectsStory: View {
      @Environment(HostStore.self) private var host

      var body: some View {
        List {
          ForEach(host.projects) { project in
            HomeProjectSection(project: project, newSession: {}, present: { _ in }, remove: {}) {
              if project.id == host.projects.first?.id { Text("Projects") }
            }
          }
        }
        .listStyle(.plain)
        .navigationTitle("Home")
      }
    }

    /// A session's tab pills, scrolled as they are on a phone and wrapped to show them all.
    private struct AgentTabsStory: View {
      private let agents = GalleryFixtures.agentTabs

      var body: some View {
        VStack(alignment: .leading, spacing: 12) {
          bar(Array(agents.prefix(3)), selection: "a-tab-paused")
          bar(Array(agents.suffix(2)), selection: "a-tab-pin")
        }
        .padding(16)
      }

      private func bar(_ shown: [RemoteAgentStatus], selection: String) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
          PillTabBar(
            tabs: shown.map { agent in
              PillTab(
                id: agent.agentId, title: Labels.agentName(agent, among: agents), symbol: agent.tabSymbol,
                indicator: agent.awaiting != nil)
            },
            selection: selection, compact: true
          ) { _ in }
        }
      }
    }

    private struct UsageLimitsSectionStory: View {
      @Environment(HostStore.self) private var host

      var body: some View {
        List {
          if let window = UsageLimitFormat.sessionWindow(host.usageLimits, runner: nil, accountId: "work") {
            Section { SessionUsageRow(window: window) }
          }
        }
      }
    }

    /// A session's screen while its worktree is set up, or after that failed.
    private static func setup(_ id: String, _ session: String) -> GalleryStory {
      GalleryStory(id, fixtures: GalleryFixtures.home, setup: load) {
        SessionView(sessionId: session, label: "Session", repoRoot: GalleryFixtures.argusRoot)
      }
    }

    /// Home under the app-wide notice that another device removed this phone from the account.
    private static var accountRemoved: GalleryStory {
      GalleryStory(
        "home/account-removed", fixtures: GalleryFixtures.home,
        setup: { stage in
          await load(stage)
          stage.app.account.galleryFill(GalleryAccount(phase: .signedOut, selfKind: "ios", removed: true))
        }
      ) {
        ProjectsView().safeAreaInset(edge: .top, spacing: 0) { AccountRemovedNotice() }
      }
    }

    private static var searchFixtures: [String: String] {
      GalleryFixtures.home.merging(GalleryFixtures.teammates()) { $1 }
    }

    @MainActor static func loadSearch(_ stage: GalleryStage) async {
      await load(stage)
      await stage.teammates.refresh()
    }

    @MainActor static func load(_ stage: GalleryStage) async {
      let computer = DeviceIdentity(
        deviceId: "mac", devPrivB64: "", devPubB64: "", desktopPubB64: "", url: "ws://studio.local:7777",
        capabilities: ["monitor", "control"], hostName: "Mac Studio")
      stage.app.pairedHosts = [computer]
      stage.app.identity = computer
      stage.app.activeHostId = computer.deviceId
      stage.app.loaded = true
      await GalleryFixtures.loadHome(stage.host)
      await stage.automations.refresh()
      await stage.proposals.refresh()
    }
  }
#endif
