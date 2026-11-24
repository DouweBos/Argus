import ArgusKit
import Foundation

/// A dozen teammates, one opened with its soul, duties, memory and threads,
/// and the template gallery — the gateway's `teammates.*` answers.
extension GalleryFixtures {
  public static let ciFixerId = "ci-fixer"

  private struct Mate {
    let id: String
    let name: String
    let handle: String
    let tagline: String
    let color: String
    var symbol: String? = nil
    var enabled = true
    var duties = 1
    var lastRunMinutes: Double? = 90
    var unread = false
    var autonomy: String? = "propose"
  }

  private static let mates: [Mate] = [
    Mate(
      id: ciFixerId, name: "CI Fixer", handle: "ci-fixer",
      tagline: "Turns red CI on your pull requests green again.", color: "red", symbol: "wrench",
      duties: 2, lastRunMinutes: 12, unread: true, autonomy: "draft"),
    Mate(
      id: "reviewer", name: "PR Reviewer", handle: "reviewer",
      tagline: "Drafts the review when someone asks for yours.", color: "purple", symbol: "eye",
      lastRunMinutes: 45),
    Mate(
      id: "triager", name: "Issue Triager", handle: "triager",
      tagline: "Sorts new issues and picks what to work on next.", color: "orange", symbol: "tray",
      duties: 2, lastRunMinutes: 300, unread: true),
    Mate(
      id: "deps", name: "Dependency Bumper", handle: "deps",
      tagline: "Says what is behind and which upgrades are worth a branch.", color: "green",
      symbol: "shippingbox", lastRunMinutes: 4000),
    Mate(
      id: "notes", name: "Release Notes Writer", handle: "release-notes",
      tagline: "Drafts release notes from what merged since the last tag.", color: "blue", symbol: "doc",
      enabled: false, lastRunMinutes: nil),
    Mate(
      id: "flaky", name: "Flaky Test Hunter", handle: "flaky-hunter",
      tagline: "Finds the tests that fail and pass on the same commit.", color: "yellow", symbol: "ant",
      lastRunMinutes: 600),
    Mate(
      id: "standup", name: "Standup Prep", handle: "standup",
      tagline: "What landed, what is in flight and what stalled.", color: "teal", symbol: "calendar",
      lastRunMinutes: 1400),
    Mate(
      id: "janitor", name: "Branch Janitor", handle: "janitor",
      tagline: "Proves which branches are safe to clean up.", color: "pink", symbol: "leaf",
      lastRunMinutes: 2000),
    Mate(
      id: "maya", name: "Maya", handle: "maya", tagline: "", color: "purple", duties: 0,
      lastRunMinutes: nil, autonomy: nil),
    Mate(
      id: "docs", name: "Docs Gardener", handle: "docs",
      tagline: "Finds docs that drifted from the code.", color: "green", symbol: "sparkles", enabled: false,
      lastRunMinutes: nil),
    Mate(
      id: "perf", name: "Perf Watcher", handle: "perf",
      tagline: "Flags bundle size and startup regressions on every merge.", color: "orange", symbol: "bolt",
      duties: 3, lastRunMinutes: 30, autonomy: "pr"),
    Mate(
      id: "a11y", name: "Accessibility Auditor With A Very Long Name", handle: "a11y",
      tagline: "Walks every screen with VoiceOver labels and contrast checks, weekly.", color: "blue",
      symbol: "magnifyingglass", lastRunMinutes: 9000),
  ]

  private static let ciFixerSoul = """
    You are CI Fixer. You care about one thing: the user's pull requests being green.

    - Read the failing log before you theorise. Quote the line that failed.
    - Prefer sending the fix back to the session that wrote the branch; it knows the change.
    - Be brief. A fix, the evidence, and what you did.
    """

  private static func teammateJSON(_ m: Mate) -> [String: Any] {
    [
      "id": m.id, "name": m.name, "handle": m.handle, "tagline": m.tagline, "color": m.color,
      "avatar": m.symbol.map { ["kind": "symbol", "symbol": $0] } ?? ["kind": "initials"],
      "enabled": m.enabled, "scope": ["repo_roots": ["/Users/dev/Projects/Argus"]],
      "source_ids": ["github-prs"], "autonomy": m.autonomy as Any,
      "guardrails": [
        "confidence_threshold": 0.8, "max_concurrent_sessions": 2, "max_files_changed": 25,
        "max_cost_usd_per_run": 0, "max_run_minutes": 20, "path_denylist": [String](),
        "require_clean_ci": true, "retry_other_accounts": true,
      ],
      "runner": NSNull(), "model": NSNull(), "claude_account_id": NSNull(),
      "template_id": m.symbol == nil ? NSNull() : m.id as Any, "seeded_soul_hash": NSNull(),
      "created_at": ago(60 * 24 * 20), "updated_at": ago(60),
    ]
  }

  private static func summaryJSON(_ m: Mate) -> [String: Any] {
    [
      "teammate": teammateJSON(m), "duty_count": m.duties,
      "last_run_at": m.lastRunMinutes.map(ago) as Any, "has_unread_report": m.unread,
    ]
  }

  private static func duty(
    id: String, name: String, trigger: String, cron: String? = nil, running: Bool = false
  ) -> [String: Any] {
    [
      "id": id, "name": name, "description": "", "enabled": true, "trigger_kind": trigger,
      "cron": cron as Any, "timezone": cron == nil ? NSNull() : "Europe/Amsterdam" as Any,
      "autonomy": "draft", "projects": ["Argus"], "last_run_at": ago(12),
      "next_run_at": cron == nil ? NSNull() : ago(-30) as Any, "running": running, "teammate_id": ciFixerId,
    ]
  }

  private static var ciFixerDetail: [String: Any] {
    [
      "teammate": teammateJSON(mates[0]), "soul": ciFixerSoul, "memory_count": 3,
      "duties": [
        duty(id: redCiId, name: "Fix my red CI", trigger: "signal", running: true),
        duty(id: "shepherd", name: "PR shepherd", trigger: "schedule", cron: "*/30 * * * *"),
      ],
    ]
  }

  private static var threads: [[String: Any]] {
    [
      thread("th1", "Why does the iOS job keep timing out on main?", minutes: 8),
      thread("th2", "Remember that the e2e suite needs the staging token", minutes: 60 * 26, surface: "slack"),
      thread("th4", "Take over the flaky upload test from the release shepherd", minutes: 60 * 50, surface: "handoff"),
      thread("th3", "", minutes: 60 * 24 * 6),
    ]
  }

  private static func thread(
    _ id: String, _ title: String, minutes: Double, surface: String = "direct"
  ) -> [String: Any] {
    [
      "id": id, "teammate_id": ciFixerId, "surface": surface, "title": title,
      "agent_id": "teammate-\(id)", "created_at": ago(minutes + 30), "last_opened_at": ago(minutes),
      "archived": false,
    ]
  }

  private static var teammateMemories: [[String: Any]] {
    [
      [
        "name": "ios-job-timeouts", "description": "The iOS job times out when the simulator cache is cold",
        "type": "project", "body": "Rerun once before touching code.", "updated_at": ago(300),
      ],
      [
        "name": "staging-token", "description": "The e2e suite needs STAGING_TOKEN; ask, never guess",
        "type": "reference", "body": "Lives in 1Password under Argus CI.", "updated_at": ago(1500),
      ],
      [
        "name": "no-force-push", "description": "Never force-push a teammate's branch",
        "type": "feedback", "body": "**Why:** it lost review comments once.", "updated_at": ago(9000),
      ],
    ]
  }

  private static var templates: [[String: Any]] {
    mates.prefix(8).map { m in
      [
        "id": m.id, "name": m.name, "handle": m.handle, "tagline": m.tagline, "color": m.color,
        "avatar": ["kind": "symbol", "symbol": m.symbol ?? "person"], "soul": "",
        "autonomy": m.autonomy ?? "propose", "source_ids": [String](),
        "requires": m.id == "standup" ? ["github", "linear"] : ["github"],
        "duty_names": m.duties > 1 ? ["Fix my red CI", "PR shepherd"] : [m.name],
      ]
    }
  }

  public static func teammates(empty: Bool = false) -> [String: String] {
    automations(empty: empty).merging([
      ArgusProtocol.Methods.TeammatesList.name: GalleryJSON.encode([
        "teammates": empty ? [] : mates.map(summaryJSON)
      ]),
      ArgusProtocol.Methods.TeammatesGet.name: GalleryJSON.encode(ciFixerDetail),
      ArgusProtocol.Methods.TeammatesThreads.name: GalleryJSON.encode(["threads": threads]),
      ArgusProtocol.Methods.TeammatesMemories.name: GalleryJSON.encode(["memories": teammateMemories]),
      ArgusProtocol.Methods.TeammatesTemplates.name: GalleryJSON.encode(["templates": templates]),
      ArgusProtocol.Methods.TeammatesOpenThread.name: GalleryJSON.encode([
        "thread": threads[0], "agent_id": "teammate-th1", "session_id": "teammate-thread-th1",
      ]),
    ]) { _, new in new }
  }
}
