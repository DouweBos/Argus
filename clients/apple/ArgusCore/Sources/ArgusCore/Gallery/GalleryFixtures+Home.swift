import ArgusKit
import Foundation

/// Home, projects and sessions: a dozen projects, sessions in every state and
/// agents running, waiting, idle and failed — the same data on both galleries.
extension GalleryFixtures {
  public static let argusRoot = "/Users/dev/Projects/Argus"
  static func root(_ name: String) -> String { "/Users/dev/Projects/\(name)" }

  /// Milliseconds since 1970, `minutes` ago, as the host stamps times.
  static func ago(_ minutes: Double) -> Double { (Date().timeIntervalSince1970 - minutes * 60) * 1000 }

  public static func session(
    _ id: String, repo: String = "Argus", branch: String, name: String? = nil, kind: String = "worktree",
    status: String = "ready", pr: (Int, String)? = nil, extra: [String: Any] = [:]
  ) -> [String: Any] {
    var json: [String: Any] = [
      "id": id, "repo_root": root(repo), "kind": kind, "branch": branch, "status": status, "base_branch": "main",
    ]
    if let name { json["display_name"] = name }
    if let pr {
      json["pull_request"] = ["number": pr.0, "state": pr.1, "url": "https://github.com/acme/\(repo)/pull/\(pr.0)"]
    }
    return json.merging(extra) { _, new in new }
  }

  public static func agent(
    _ id: String, session: String, label: String, project: String = "Argus", title: String,
    status: String, awaiting: String? = nil, minutes: Double, model: String = "claude-opus-5-5"
  ) -> [String: Any] {
    var json: [String: Any] = [
      "agent_id": id, "session_id": session, "session_label": label, "project_name": project, "title": title,
      "status": status, "model": model, "created_at": ago(minutes + 30), "last_activity_at": ago(minutes),
      "permission_mode": "default",
    ]
    if let awaiting { json["awaiting"] = awaiting }
    return json
  }

  /// Argus's sessions: the project root, then worktrees ready, setting up, failed, tearing down and on a missing disk.
  public static var argusSessions: [[String: Any]] {
    [
      session("s-root", branch: "main", kind: "project_root"),
      session("s-pr", branch: "watch-pr-tool", name: "Watch pull request tool", pr: (412, "open")),
      session(
        "s-long", branch: "douwe/rework-the-onboarding-flow-for-new-machines",
        name: "Rework the onboarding flow so a brand new machine gets from download to first agent in one go",
        pr: (415, "draft")),
      session("s-merged", branch: "linear-picker", name: "Linear issue picker", pr: (398, "merged")),
      session(
        "s-setup", branch: "gallery-stories", name: "Gallery stories for sessions", status: "initializing",
        extra: ["progress": ["current": 3, "total": 5]]),
      session(
        "s-failed", branch: "pnpm-upgrade", name: "Upgrade pnpm", status: "error",
        extra: ["setup_error": "pnpm install exited with code 1: ERR_PNPM_OUTDATED_LOCKFILE Cannot install with \"frozen-lockfile\""]),
      session(
        "s-teardown", branch: "checkout-db", name: "Per-branch checkout database", status: "deleting",
        extra: [
          "progress": [
            "current": 0, "total": 2, "phase": "teardown",
            "detail": "Container storefront-db-14  Stopping",
          ]
        ]),
      session(
        "s-teardown-failed", branch: "search-index", name: "Search index rebuild", status: "error",
        extra: [
          "delete_failed": "teardown",
          "setup_error":
            "Teardown command failed (exit 1): docker compose down -v\nCannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?",
        ]),
      session(
        "s-offline", branch: "external-disk", name: "Archive on the external disk",
        extra: ["availability": "unavailable", "unavailable_volume": "Samsung T7"]),
    ]
  }

  public static var agents: [[String: Any]] {
    [
      agent(
        "a-run", session: "s-pr", label: "Watch pull request tool", title: "Add a watch tool for pull requests",
        status: "running", minutes: 0.5),
      agent(
        "a-perm", session: "s-long", label: "Rework onboarding", title: "Rework the onboarding flow for new machines",
        status: "requires_action", awaiting: "permission", minutes: 2),
      agent(
        "a-root", session: "s-root", label: "main", title: "Why does the release workflow skip notarization?",
        status: "idle", minutes: 25),
      agent(
        "a-err", session: "s-merged", label: "Linear issue picker", title: "Linear issue picker",
        status: "error", minutes: 90),
      agent(
        "a-rn", session: "rn-1", label: "Fix the Android build", project: "react-native-client",
        title: "Fix the Android release build on CI", status: "running", minutes: 1, model: "claude-sonnet-5-5"),
      agent(
        "a-rn2", session: "rn-root", label: "main", project: "react-native-client",
        title: "Plan the navigation migration", status: "requires_action", awaiting: "plan", minutes: 6),
      agent(
        "a-cond", session: "c-1", label: "Long press gesture", project: "conductor",
        title: "Support long press in tap-on", status: "idle", minutes: 180),
      agent(
        "a-luma", session: "l-1", label: "Dark mode tokens", project: "luma", title: "Dark mode tokens",
        status: "idle", minutes: 60 * 26),
    ]
  }

  private static func agents(in project: String) -> [[String: Any]] {
    agents.filter { $0["project_name"] as? String == project }
  }

  private static func gitStatus(_ branch: String = "main", ahead: Int, behind: Int = 0, dirty: Int = 0, add: Int = 0, del: Int = 0) -> String {
    GalleryJSON.encode([
      "status": [
        "branch": branch, "ahead": ahead, "behind": behind, "dirty_count": dirty, "stash_count": 0,
        "conflict_count": 0, "detached": false, "diff_additions": add, "diff_deletions": del,
      ]
    ])
  }

  public static var usageLimits: String {
    GalleryJSON.encode([
      "accounts": [
        [
          "account_id": "work", "label": "Work", "status": "ok", "subscription_type": "max", "checked_at": ago(1),
          "windows": [
            ["id": "session", "kind": "session", "label": "Session", "used_percent": 64, "resets_at": ago(-120)],
            ["id": "weekly", "kind": "weekly", "label": "Weekly", "used_percent": 91, "resets_at": ago(-60 * 50)],
          ],
        ],
        [
          "account_id": "personal", "label": "Personal", "status": "ok", "subscription_type": "pro",
          "checked_at": ago(1),
          "windows": [
            ["id": "session", "kind": "session", "label": "Session", "used_percent": 12, "resets_at": ago(-200)],
            ["id": "weekly", "kind": "weekly", "label": "Weekly", "used_percent": 38, "resets_at": ago(-60 * 90)],
          ],
        ],
      ]
    ])
  }

  static func run(
    _ id: String, name: String, status: String, minutes: Double, unread: Bool = false, error: String? = nil
  ) -> [String: Any] {
    var run: [String: Any] = [
      "id": id, "automation_id": "auto-\(id)", "automation_name": name, "is_quick": false, "status": status,
      "trigger_reason": "schedule", "started_at": ago(minutes), "unread_report": unread, "feedback": [], "report_read": !unread && status != "failed",
    ]
    if status != "running" { run["finished_at"] = ago(minutes - 3) }
    if let error { run["error"] = error }
    return run
  }

  public static var runs: [[String: Any]] {
    [
      run("r1", name: "Weekly dependency digest", status: "succeeded", minutes: 40, unread: true),
      run("r2", name: "Triage new issues", status: "running", minutes: 2),
      run("r3", name: "Nightly flaky test hunt", status: "failed", minutes: 300, error: "Usage limit reached"),
      run("r4", name: "Release notes draft", status: "succeeded", minutes: 60 * 20),
    ]
  }

  /// Everything home, the projects list and a project's sessions read.
  public static var home: [String: String] {
    var fixtures: [String: String] = [
      RemoteMethod.projectsList.rawValue: GalleryJSON.projects(GalleryJSON.someProjects),
      RemoteMethod.sessionsList.rawValue: GalleryJSON.encode(["sessions": []]),
      RemoteMethod.agentsList.rawValue: GalleryJSON.encode(["agents": agents]),
      RemoteMethod.agentsStopped.rawValue: GalleryJSON.encode(["agents": []]),
      RemoteMethod.scratchPadsList.rawValue: GalleryJSON.encode([
        "sessions": [session("pad-1", repo: ".scratch/pad-1", branch: "pad-1", name: "Regex for log lines", kind: "scratch_pad")]
      ]),
      RemoteMethod.usageLimits.rawValue: usageLimits,
      RemoteMethod.automationsList.rawValue: GalleryJSON.encode(["automations": []]),
      RemoteMethod.automationsRuns.rawValue: GalleryJSON.encode(["runs": runs]),
      RemoteMethod.proposalsList.rawValue: GalleryJSON.encode(["proposals": []]),
      ArgusProtocol.Commands.ProposalsList.name: "[]",
      ArgusProtocol.Commands.AutomationRunsList.name: GalleryJSON.encode(runs),
      RemoteMethod.sessionsGitStatus.rawValue: gitStatus(ahead: 0),
      "integrations.list": GalleryJSON.encode(["integrations": []]),
      RemoteMethod.devicesList.rawValue: GalleryJSON.encode(["devices": []]),
      RemoteMethod.sessionsMergeBlockers.rawValue: GalleryJSON.encode(["blockers": []]),
      ArgusProtocol.Commands.ListEditors.name: "[]",
      RemoteMethod.sessionsBranches.rawValue: GalleryJSON.encode([
        "branches": ["main", "release/0.80", "watch-pr-tool", "linear-picker"].map {
          ["name": $0, "scope": "local", "is_current": $0 == "main", "ahead": 0, "behind": 0]
        }
      ]),
    ]
    let sessions: [String: [[String: Any]]] = [
      "Argus": argusSessions,
      "react-native-client": [
        session("rn-root", repo: "react-native-client", branch: "main", kind: "project_root"),
        session("rn-1", repo: "react-native-client", branch: "android-ci", name: "Fix the Android build", pr: (88, "open")),
      ],
      "conductor": [
        session("c-root", repo: "conductor", branch: "main", kind: "project_root"),
        session("c-1", repo: "conductor", branch: "long-press", name: "Long press gesture"),
      ],
      "luma": [
        session("l-root", repo: "luma", branch: "main", kind: "project_root"),
        session("l-1", repo: "luma", branch: "dark-tokens", name: "Dark mode tokens"),
      ],
    ]
    for (project, list) in sessions {
      fixtures["\(RemoteMethod.sessionsList.rawValue)?repo_root=\(root(project))"] = GalleryJSON.encode(["sessions": list])
    }
    for project in GalleryJSON.someProjects {
      fixtures["\(RemoteMethod.agentsList.rawValue)?repo_root=\(root(project))"] = GalleryJSON.encode([
        "agents": agents(in: project)
      ])
    }
    let git = [
      "s-pr": gitStatus("watch-pr-tool", ahead: 3, add: 214, del: 38), "s-long": gitStatus("douwe/rework-the-onboarding-flow-for-new-machines", ahead: 12, behind: 4, dirty: 7, add: 1840, del: 512),
      "s-merged": gitStatus("linear-picker", ahead: 0), "s-root": gitStatus(ahead: 0, behind: 2),
    ]
    for (id, status) in git { fixtures["\(RemoteMethod.sessionsGitStatus.rawValue)?session_id=\(id)"] = status }
    return fixtures
  }

  /// No projects at all: a fresh install.
  public static var homeEmpty: [String: String] {
    home.merging([
      RemoteMethod.projectsList.rawValue: GalleryJSON.projects([]),
      RemoteMethod.agentsList.rawValue: GalleryJSON.encode(["agents": []]),
      RemoteMethod.automationsRuns.rawValue: GalleryJSON.encode(["runs": []]),
      ArgusProtocol.Commands.AutomationRunsList.name: "[]",
      RemoteMethod.scratchPadsList.rawValue: GalleryJSON.encode(["sessions": []]),
    ]) { _, new in new }
  }

  /// What a home story loads before it shows: every project's sessions and agents.
  @MainActor
  public static func loadHome(_ host: HostStore) async {
    await host.loadRecentAgents()
    await host.loadScratchPads()
    await host.loadUsageLimits()
    for project in host.projects {
      await host.loadSessions(repoRoot: project.repoRoot)
      await host.loadAgents(repoRoot: project.repoRoot)
    }
  }
}

extension GalleryFixtures {
  /// One of Argus's fixture sessions, decoded, for a component that takes one.
  public static func argusSession(_ id: String) -> RemoteSession {
    argusSession(id, overrides: [:])
  }

  /// A fixture session with some fields changed, e.g. `["setup_pending": true]`.
  public static func argusSession(_ id: String, overrides: [String: Any]) -> RemoteSession {
    var json = argusSessions.first { $0["id"] as? String == id } ?? argusSessions[0]
    json.merge(overrides) { _, new in new }
    return try! ProtocolCodec.decoder.decode(RemoteSession.self, from: Data(GalleryJSON.encode(json).utf8))
  }
}

extension GalleryFixtures {
  public static var argusProject: RemoteProject {
    try! ProtocolCodec.decoder.decode(
      RemoteProject.self, from: Data(GalleryJSON.encode(["repo_root": argusRoot, "name": "Argus"]).utf8))
  }
}
