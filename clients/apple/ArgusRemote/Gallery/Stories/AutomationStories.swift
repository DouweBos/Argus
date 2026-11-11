#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI

  /// Automations, runs, the inbox, proposals, notifications and usage — the
  /// same ids and fixtures as the Mac gallery's `AutomationStories`.
  enum AutomationStories {
    static var all: [GalleryStory] {
      [
        GalleryStory("automations/list", fixtures: fixtures, setup: loadSessions) { AutomationsView() },
        GalleryStory("automations/list/empty", fixtures: empty) { AutomationsView() },
        GalleryStory("automations/detail", fixtures: fixtures, setup: loadSessions) {
          AutomationView(automationId: GalleryFixtures.triageId, label: "Triage new GitHub issues")
        },
        GalleryStory("automations/editor", fixtures: fixtures) {
          AutomationEditorView(automationId: GalleryFixtures.triageId)
        },
        GalleryStory("automations/run", fixtures: fixtures, setup: loadSessions) {
          RunView(runId: "r-deps-1", label: "Weekly dependency digest")
        },
        GalleryStory("automations/quick-run", fixtures: fixtures) { QuickRunView() },
        GalleryStory("automations/quick-run/empty", fixtures: empty) { QuickRunView() },
        GalleryStory("automations/describe", fixtures: fixtures) { DescribeAutomationView() },
        GalleryStory("inbox", fixtures: fixtures, setup: loadSessions) { InboxView() },
        GalleryStory("inbox/empty", fixtures: empty) { InboxView() },
        GalleryStory("inbox/proposal", fixtures: fixtures, setup: loadSessions) {
          ProposalView(proposalId: "p-crash")
        },
        GalleryStory("notifications", setup: { GalleryFixtures.notifications(into: $0.app.notifications) }) {
          WarningsView()
        },
        GalleryStory("notifications/empty", setup: { $0.app.notifications.clear() }) { WarningsView() },
        GalleryStory("usage/limits", fixtures: GalleryFixtures.usage) { HostUsageView() },
        GalleryStory("usage/cost", fixtures: GalleryFixtures.usage) {
          HostUsageView(tab: .constant(.cost), range: .constant(._7d))
        },
        GalleryStory("usage/tokens", fixtures: GalleryFixtures.usage) {
          HostUsageView(tab: .constant(.tokens), range: .constant(._7d))
        },
      ]
    }

    private static var fixtures: [String: String] { GalleryFixtures.automations() }
    private static var empty: [String: String] { GalleryFixtures.automations(empty: true) }

    /// The inbox's "on it" group only lists work whose session still exists.
    @MainActor
    private static func loadSessions(_ stage: GalleryStage) async {
      for project in stage.host.projects { await stage.host.loadSessions(repoRoot: project.repoRoot) }
    }
  }
#endif
