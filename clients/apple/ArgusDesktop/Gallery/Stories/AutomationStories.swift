#if DEBUG
  import ArgusCore
  import ArgusUI
  import SwiftUI

  enum AutomationStories {
    static var all: [GalleryStory] {
      [
        GalleryStory(
          "automations/quick-run", size: CGSize(width: 1000, height: 900), chrome: true,
          fixtures: fixtures(runs: [run("q1", status: "running", ago: 2, cost: nil)])
        ) {
          QuickRunScreen(runId: nil)
        },
        GalleryStory(
          "automations/quick-run/empty", size: CGSize(width: 1000, height: 900), chrome: true,
          fixtures: fixtures(runs: [])
        ) {
          QuickRunScreen(runId: nil)
        },
        GalleryStory("automations/project-scope", size: CGSize(width: 640, height: 640), fixtures: fixtures(runs: [])) {
          ScopeForm(picked: ["/Users/dev/Projects/Argus"])
        },
        GalleryStory("automations/run-history-row", size: CGSize(width: 720, height: 300), fixtures: fixtures(runs: [])) {
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
      ]
    }

    private static func fixtures(runs: [[String: Any]]) -> [String: String] {
      [
        RemoteMethod.projectsList.rawValue: GalleryJSON.projects(GalleryJSON.someProjects),
        RemoteMethod.automationsList.rawValue: GalleryJSON.encode(["automations": []]),
        RemoteMethod.automationsRuns.rawValue: GalleryJSON.encode(["runs": runs]),
        RemoteMethod.automationsSources.rawValue: GalleryJSON.encode([
          "sources": [
            ["id": "github", "label": "GitHub issues and PRs", "mode": "native", "available": true],
            ["id": "linear", "label": "Linear", "mode": "agent", "available": false],
          ]
        ]),
      ]
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
