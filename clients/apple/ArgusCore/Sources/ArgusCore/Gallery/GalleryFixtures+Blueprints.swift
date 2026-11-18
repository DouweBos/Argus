import ArgusKit
import Foundation

/// Blueprints and the projects made from them, for both galleries.
extension GalleryFixtures {
  private static var nowMs: Double { Date().timeIntervalSince1970 * 1000 }
  private static let projectsDir = "/Users/dev/Projects"

  public static let macAppBlueprintId = "mac-app"
  public static let runningBlueprintRunId = "run-tally"
  public static let failedBlueprintRunId = "run-ledger"

  private static func ref(_ name: String, _ note: String) -> [String: Any] {
    ["path": "\(projectsDir)/\(name)", "note": note]
  }

  private static func blueprint(
    _ id: String, _ name: String, _ summary: String, references: [[String: Any]],
    template: String? = nil, visibility: String = "private", github: Bool = true, owner: String = "",
    runner: String? = nil, model: String? = nil
  ) -> [String: Any] {
    [
      "id": id, "name": name, "summary": summary, "parent_dir": "~/Work/Apps",
      "references": references,
      "scaffold": template.map { ["kind": "github_template", "repo": $0] } ?? ["kind": "empty"],
      "github": ["enabled": github, "owner": owner, "visibility": visibility],
      "copy_project_settings_from": (references.first?["path"] as? String) ?? NSNull(),
      "instructions": """
        # {{name}}

        {{description}}

        Mirror the reference app's layout: `Sources/`, `Tests/` and a single Xcode project.
        Copy `.github/workflows/release.yml` from the first reference and swap the bundle id \
        for `dev.houwert.{{name}}`.
        Set up Sparkle with the same appcast layout, then commit and push to {{repo}}.
        """,
      "agent": ["runner": runner as Any? ?? NSNull(), "model": model as Any? ?? NSNull(), "permission_mode": NSNull()],
      "created_at": nowMs - 86_400_000 * 9, "updated_at": nowMs - 86_400_000,
    ]
  }

  private static var blueprintRecords: [[String: Any]] {
    [
      blueprint(
        macAppBlueprintId, "SwiftUI Mac app", "Sandboxed SwiftUI app with Sparkle updates and a notarised release",
        references: [
          ref("Argus", "release workflow, signing and the update feed"),
          ref("Grove", "menu bar extra and settings window"),
        ]),
      blueprint(
        "expo", "Expo app", "React Native app on Expo with EAS builds and OTA updates",
        references: [ref("react-native-client", "EAS profiles and the release lane")],
        template: "houwert/expo-template", model: "sonnet"),
      blueprint(
        "web", "Static site", "Astro site deployed to Cloudflare Pages",
        references: [ref("houwert.dev", "")], visibility: "public"),
      blueprint(
        "cli", "Node CLI", "TypeScript CLI published to npm with changesets",
        references: [ref("conductor", "package layout"), ref("Charon", "release workflow"), ref("Maestro", "")],
        runner: "codex"),
      blueprint(
        "tv", "TV receiver", "Chromecast and web TV receiver sharing one player",
        references: [ref("vizbee-chromecast-receiver", "cast receiver"), ref("web-tv-client", "player")],
        owner: "plex-labs"),
      blueprint("scratch", "Local experiment", "A local repo with no GitHub, for trying things", references: [], github: false),
    ]
  }

  private static func step(_ key: String, _ status: String, _ error: String? = nil) -> [String: Any] {
    ["key": key, "status": status, "error": error as Any? ?? NSNull()]
  }

  private static var blueprintRunRecords: [[String: Any]] {
    [
      [
        "id": runningBlueprintRunId, "blueprint_id": macAppBlueprintId, "project_name": "tally",
        "repo_root": "/Users/dev/Work/Apps/tally", "repo_url": "https://github.com/houwert/tally",
        "status": "running",
        "steps": [
          step("validate", "done"), step("create_repo", "done"), step("register", "running"),
          step("start_agent", "pending"),
        ],
        "session_id": NSNull(), "agent_id": NSNull(), "started_at": nowMs - 8_000, "finished_at": NSNull(),
      ],
      [
        "id": failedBlueprintRunId, "blueprint_id": macAppBlueprintId, "project_name": "ledger",
        "repo_root": "/Users/dev/Work/Apps/ledger", "repo_url": NSNull(), "status": "failed",
        "steps": [
          step("validate", "failed", "Not authenticated with GitHub. Run `gh auth login` to sign in."),
          step("create_repo", "pending"), step("register", "pending"), step("start_agent", "pending"),
        ],
        "session_id": NSNull(), "agent_id": NSNull(), "started_at": nowMs - 3_600_000,
        "finished_at": nowMs - 3_598_000,
      ],
      [
        "id": "run-orbit", "blueprint_id": macAppBlueprintId, "project_name": "orbit",
        "repo_root": "/Users/dev/Work/Apps/orbit", "repo_url": "https://github.com/houwert/orbit",
        "status": "done",
        "steps": ["validate", "create_repo", "register", "start_agent"].map { step($0, "done") },
        "session_id": "s-orbit", "agent_id": "a-orbit", "started_at": nowMs - 86_400_000 * 3,
        "finished_at": nowMs - 86_400_000 * 3 + 40_000,
      ],
    ]
  }

  /// The blueprint list, its runs and the projects a reference picker offers.
  public static var blueprints: [String: String] {
    [
      "blueprints.list": GalleryJSON.encode(["blueprints": blueprintRecords]),
      "blueprints.runs": GalleryJSON.encode(["runs": blueprintRunRecords]),
      RemoteMethod.projectsList.rawValue: GalleryJSON.projects(GalleryJSON.someProjects),
    ].merging(composer) { a, _ in a }
  }

  public static var noBlueprints: [String: String] {
    [
      "blueprints.list": GalleryJSON.encode(["blueprints": []]),
      "blueprints.runs": GalleryJSON.encode(["runs": []]),
      RemoteMethod.projectsList.rawValue: GalleryJSON.projects(GalleryJSON.someProjects),
    ]
  }

  /// Only the running or only the failed project, for the new-project sheet's states.
  public static func blueprints(onlyRun runId: String) -> [String: String] {
    var fixtures = blueprints
    fixtures["blueprints.runs"] = GalleryJSON.encode([
      "runs": blueprintRunRecords.filter { ($0["id"] as? String) == runId }
    ])
    return fixtures
  }
}
