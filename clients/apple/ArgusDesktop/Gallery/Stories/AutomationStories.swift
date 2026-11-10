#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI

  /// Automations, runs, the inbox, proposals, notifications and usage — the
  /// same ids and fixtures as the iOS gallery's `AutomationStories`.
  enum AutomationStories {
    private static let screen = CGSize(width: 1000, height: 900)

    static var all: [GalleryStory] {
      [
        GalleryStory(
          "automations/list", size: CGSize(width: 1100, height: 560), chrome: true, fixtures: fixtures,
          setup: attachModel
        ) { AutomationsScreen() },
        GalleryStory(
          "automations/list/empty", size: CGSize(width: 1000, height: 560), chrome: true,
          fixtures: GalleryFixtures.automations(empty: true), setup: attachModel
        ) { AutomationsScreen() },
        GalleryStory(
          "automations/detail", size: CGSize(width: 1000, height: 2400), chrome: true, fixtures: fixtures,
          setup: attachModel
        ) { AutomationScreen(automationId: GalleryFixtures.triageId, runId: nil) },
        GalleryStory(
          "automations/run", size: screen, chrome: true, fixtures: fixtures, setup: attachModel
        ) { AutomationScreen(automationId: "deps", runId: "r-deps-1") },
        GalleryStory(
          "automations/quick-run", size: CGSize(width: 1000, height: 1100), chrome: true, fixtures: fixtures,
          setup: attachModel
        ) { QuickRunScreen(runId: nil) },
        GalleryStory(
          "automations/quick-run/empty", size: screen, chrome: true,
          fixtures: GalleryFixtures.automations(empty: true), setup: attachModel
        ) { QuickRunScreen(runId: nil) },
        GalleryStory("automations/describe", size: CGSize(width: 620, height: 0), fixtures: fixtures) {
          DescribeAutomationSheet()
        },
        GalleryStory("automations/project-scope", size: CGSize(width: 640, height: 640), fixtures: fixtures) {
          ScopeForm(picked: ["/Users/dev/Projects/Argus"])
        },
        GalleryStory("automations/run-history-row", size: CGSize(width: 720, height: 300), fixtures: fixtures) {
          Form {
            Section("Run history") {
              RunHistoryRow(run: decoded(run("a", status: "running", ago: 1, cost: nil)), title: "Quick run") {}
              RunHistoryRow(run: decoded(run("b", status: "succeeded", ago: 600, cost: 0.42)), title: "Weekly digest") {}
              RunHistoryRow(
                run: decoded(run("c", status: "failed", ago: 3600, cost: 0.08, error: "Usage limit reached")),
                title: "Triage issues") {}
            }
          }
          .formStyle(.grouped)
        },
        GalleryStory("inbox", size: CGSize(width: 1000, height: 1500), chrome: true, fixtures: fixtures, setup: attachModel) {
          InboxScreen()
        },
        GalleryStory(
          "inbox/empty", size: CGSize(width: 1000, height: 560), chrome: true,
          fixtures: GalleryFixtures.automations(empty: true), setup: attachModel
        ) { InboxScreen() },
        GalleryStory("inbox/proposal", size: screen, chrome: true, fixtures: fixtures, setup: attachModel) {
          ProposalScreen(proposalId: "p-crash")
        },
        GalleryStory(
          "notifications", size: CGSize(width: 900, height: 480), chrome: true,
          setup: { GalleryFixtures.notifications(into: $0.model.notificationsLog) }
        ) { NotificationsScreen() },
        GalleryStory(
          "notifications/empty", size: CGSize(width: 900, height: 480), chrome: true,
          setup: { $0.model.notificationsLog.clear() }
        ) { NotificationsScreen() },
        GalleryStory("usage/limits", size: screen, chrome: true, fixtures: GalleryFixtures.usage) {
          UsageScreen(tab: .limits, range: nil)
        },
        GalleryStory("usage/cost", size: screen, chrome: true, fixtures: GalleryFixtures.usage) {
          UsageScreen(tab: .cost, range: nil)
        },
      ]
    }

    private static var fixtures: [String: String] { GalleryFixtures.automations() }

    /// Some Mac screens read the app model's stores (the inbox, automation
    /// names) rather than the environment's, so they get the fixtures too.
    @MainActor
    private static func attachModel(_ stage: GalleryStage) async {
      let model = stage.model
      await model.store.attach(stage.backend)
      await model.store.refreshProjects()
      for project in model.store.projects { await stage.host.loadSessions(repoRoot: project.repoRoot) }
      model.automations.clear()
      model.inbox.clear()
      await model.automations.refresh()
      await model.inbox.refresh()
      await stage.automations.refresh()
    }

    private static func run(
      _ id: String, status: String, ago: Double, cost: Double?, error: String? = nil
    ) -> [String: Any] {
      var run: [String: Any] = [
        "id": id, "automation_id": "quick", "automation_name": "Quick run", "is_quick": true,
        "status": status, "trigger_reason": "manual",
        "started_at": (Date().timeIntervalSince1970 - ago) * 1000, "unread_report": false,
      ]
      if let cost { run["cost_usd"] = cost }
      if let error { run["error"] = error }
      if status != "running" { run["finished_at"] = Date().timeIntervalSince1970 * 1000 }
      return run
    }

    private static func decoded(_ run: [String: Any]) -> RemoteAutomationRun {
      try! ProtocolCodec.decoder.decode(RemoteAutomationRun.self, from: Data(GalleryJSON.encode(run).utf8))
    }
  }

  private struct ScopeForm: View {
    @State var picked: [String]

    var body: some View {
      Form {
        ProjectScopeSection(selection: $picked)
      }
      .formStyle(.grouped)
      .toggleStyle(.argusSwitch)
    }
  }
#endif
