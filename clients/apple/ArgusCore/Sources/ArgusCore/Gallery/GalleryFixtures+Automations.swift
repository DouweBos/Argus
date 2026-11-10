import ArgusKit
import Foundation

/// Automations, runs, proposals and the inbox, in both wire shapes: the
/// gateway's (`automations.*`, `proposals.*`) and the Mac catalog's
/// (`proposals_list`, `automation_runs_list`), built from the same records.
extension GalleryFixtures {
  private static var now: Double { Date().timeIntervalSince1970 * 1000 }

  public static let triageId = "triage"

  private struct Automation {
    let id: String
    let name: String
    let description: String
    var enabled = true
    var trigger = "schedule"
    var cron: String? = "0 9 * * 1-5"
    var autonomy: String? = "propose"
    var projects: [String] = ["Argus"]
    var running = false
  }

  private static let automationRecords: [Automation] = [
    Automation(
      id: triageId, name: "Triage new GitHub issues",
      description: "Reads every issue opened since the last run and proposes the ones worth picking up.",
      projects: ["Argus", "conductor"], running: true),
    Automation(
      id: "deps", name: "Weekly dependency digest",
      description: "Lists outdated packages and the breaking changes between them.",
      cron: "0 8 * * 1", autonomy: "draft", projects: ["react-native-client", "web-tv-client"]),
    Automation(
      id: "flaky", name: "Nightly flaky test hunt", description: "Reruns the suite and files what flaked.",
      cron: "0 2 * * *", autonomy: "pr", projects: ["Argus"]),
    Automation(
      id: "release", name: "Release notes draft", description: "", enabled: false, trigger: "manual",
      cron: nil, autonomy: nil, projects: ["Argus"]),
    Automation(
      id: "linear",
      name: "Groom the Linear backlog for the react-native-client team every other Monday morning",
      description:
        "Closes stale issues, merges duplicates and asks for repro steps where an issue has none, "
        + "so planning starts from a backlog that reflects reality.",
      cron: "30 9 * * 1", projects: ["react-native-client"]),
    Automation(
      id: "branches", name: "Clean up merged branches", description: "Deletes local branches already on main.",
      trigger: "once", cron: nil, autonomy: "auto_merge", projects: GalleryJSON.someProjects),
    Automation(
      id: "reviews", name: "PR review reminders", description: "Nudges pull requests idle for two days.",
      cron: "0 14 * * 1-5", projects: ["Argus", "Maestro", "luma"]),
    Automation(
      id: "a11y", name: "Accessibility audit", description: "Checks new screens against the VoiceOver checklist.",
      enabled: false, cron: "0 10 * * 5", autonomy: "draft", projects: ["iOS-App"]),
  ]

  private static func automationJSON(_ a: Automation) -> [String: Any] {
    var json: [String: Any] = [
      "id": a.id, "name": a.name, "description": a.description, "enabled": a.enabled,
      "trigger_kind": a.trigger, "timezone": "Europe/Amsterdam", "projects": a.projects,
      "running": a.running, "last_run_at": ago(45),
    ]
    if let cron = a.cron { json["cron"] = cron }
    if a.trigger == "once" { json["run_at"] = "2026-11-12T09:00" }
    if let autonomy = a.autonomy { json["autonomy"] = autonomy }
    if a.enabled, a.trigger != "manual" { json["next_run_at"] = now + 14 * 3_600_000 }
    return json
  }

  private struct Run {
    let id: String
    let automation: String
    let status: String
    let ago: Double
    var minutes: Double = 6
    var cost: Double? = 0.38
    var error: String?
    var unread = false
    var read = true
    var quick = false
    var reason = "schedule"
    var preview: String?
  }

  private static let runRecords: [Run] = [
    Run(id: "r-triage-1", automation: triageId, status: "running", ago: 3, cost: nil, reason: "manual"),
    Run(
      id: "r-deps-1", automation: "deps", status: "succeeded", ago: 90, minutes: 11, cost: 1.24, unread: true,
      read: false, preview: "14 packages behind; react-native 0.81 → 0.83 needs the new architecture flag."),
    Run(
      id: "r-flaky-1", automation: "flaky", status: "failed", ago: 380, minutes: 20, cost: 2.02,
      error: "Usage limit reached on every signed-in Claude account. The run stopped at 20 minutes.",
      read: false),
    Run(
      id: "r-triage-2", automation: triageId, status: "succeeded", ago: 1440, cost: 0.42,
      preview: "Three issues worth picking up; two duplicates closed."),
    Run(
      id: "r-quick-1", automation: "quick", status: "succeeded", ago: 30, minutes: 4, cost: 0.19, unread: true,
      read: false, quick: true, reason: "manual",
      preview: "Argus: 23 commits, conductor: 4. Nothing landed on luma."),
    Run(
      id: "r-quick-2", automation: "quick", status: "failed", ago: 200, minutes: 1, cost: 0.02,
      error: "The playbook asked for Linear, which isn't connected on this computer.", quick: true,
      reason: "manual"),
    Run(id: "r-linear-1", automation: "linear", status: "cancelled", ago: 2880, minutes: 2, cost: 0.05),
    Run(id: "r-reviews-1", automation: "reviews", status: "skipped", ago: 3000, minutes: 0, cost: nil),
    Run(id: "r-triage-3", automation: triageId, status: "succeeded", ago: 2900, cost: 0.51),
  ]

  private static func name(of automationId: String) -> String {
    automationRecords.first { $0.id == automationId }?.name ?? "Summarise the week"
  }

  private static func gatewayRun(_ r: Run) -> [String: Any] {
    var json: [String: Any] = [
      "id": r.id, "automation_id": r.automation, "automation_name": name(of: r.automation),
      "is_quick": r.quick, "status": r.status, "trigger_reason": r.reason, "started_at": ago(r.ago),
      "unread_report": r.unread, "report_read": r.read, "host_session_id": "s-\(r.id)",
      "host_agent_id": "a-\(r.id)",
    ]
    if r.status != "running" { json["finished_at"] = ago(r.ago - r.minutes) }
    if let cost = r.cost { json["cost_usd"] = cost }
    if let error = r.error { json["error"] = error }
    if let preview = r.preview { json["report_preview"] = preview }
    return json
  }

  private static func catalogRun(_ r: Run) -> [String: Any] {
    var json: [String: Any] = [
      "id": r.id, "automation_id": r.automation, "status": r.status, "trigger_reason": r.reason,
      "started_at": ago(r.ago), "report_read": r.read, "feedback": [],
      "host_session_id": "s-\(r.id)", "host_agent_id": "a-\(r.id)",
    ]
    if r.status != "running" { json["finished_at"] = ago(r.ago - r.minutes) }
    if let cost = r.cost { json["cost_usd"] = cost }
    if let error = r.error { json["error"] = error }
    if let preview = r.preview { json["report_markdown"] = preview }
    if r.quick {
      json["scratch"] = [
        "name": "Summarise the week", "playbook": "Summarise what landed on each project this week.",
        "scope": ["repo_roots": [root("Argus")]], "source_ids": [], "guardrails": guardrailsJSON,
      ]
    }
    return json
  }

  private struct Proposal {
    let id: String
    let automation: String
    let title: String
    let summary: String
    let rationale: String
    var confidence = 0.82
    var status = "pending"
    var project = "Argus"
    var source: (label: String, url: String)?
    var sessionId: String?
    var cta = "start_session"
    var clearedReason: String?
    var revision: String?
  }

  private static let proposalRecords: [Proposal] = [
    Proposal(
      id: "p-crash", automation: triageId, title: "Fix the crash when a worktree is deleted mid-merge",
      summary:
        "**#1482** reports a crash in `MergeService` when the worktree disappears while a merge is "
        + "running. The stack trace points at an unguarded `fs.stat`.\n\n- Guard the stat\n- Add a regression test",
      rationale: "Reported by three people this week, with a clear stack trace and a one-line fix.",
      confidence: 0.91, source: ("GitHub #1482", "https://github.com/acme/argus/issues/1482")),
    Proposal(
      id: "p-docs", automation: "linear", title: "Ask for repro steps on RN-2210",
      summary: "The issue says the player stutters on Android TV but gives no device or build.",
      rationale: "Can't be triaged without a device and a build number.", confidence: 0.55,
      project: "react-native-client", source: ("RN-2210", "https://linear.app/acme/issue/RN-2210"),
      cta: "open_url", revision: "Mention the Fire TV Stick builds too."),
    Proposal(
      id: "p-branch", automation: "branches", title: "Delete 14 merged branches in luma",
      summary: "Every one of these is already on `main` and has no open pull request.",
      rationale: "Safe: nothing unmerged would be lost.", confidence: 0.97, project: "luma",
      cta: "delete_branch"),
    Proposal(
      id: "p-started", automation: triageId, title: "Upgrade the terminal renderer to WebGL",
      summary: "Scrolling a long build log drops frames.", rationale: "Measurable win, low risk.",
      status: "auto_started", sessionId: "s-webgl"),
    Proposal(
      id: "p-cleared", automation: triageId, title: "Investigate the slow cold start on iPad",
      summary: "Cold start went from 1.2s to 2.8s.", rationale: "Regression in the last release.",
      status: "superseded", clearedReason: "A later run found the same regression with a profile attached."),
  ]

  private static func ctaJSON(_ p: Proposal) -> [String: Any] {
    switch p.cta {
    case "open_url": ["kind": "open_url", "label": "Open in Linear", "url": p.source?.url ?? "", "force": false]
    case "delete_branch":
      ["kind": "delete_branch", "label": "Delete branches", "branch": "feature/old", "force": false]
    default: ["kind": "start_session", "label": "Start a session", "force": false]
    }
  }

  private static func gatewayProposal(_ p: Proposal) -> [String: Any] {
    var json: [String: Any] = [
      "id": p.id, "automation_id": p.automation, "automation_name": name(of: p.automation),
      "run_id": "r-triage-2", "title": p.title, "summary": p.summary, "rationale": p.rationale,
      "confidence": p.confidence, "status": p.status, "project": p.project, "created_at": ago(120),
      "cta": ctaJSON(p),
    ]
    if let source = p.source {
      json["source_label"] = source.label
      json["source_url"] = source.url
    }
    if let sessionId = p.sessionId {
      json["session_id"] = sessionId
      json["agent_id"] = "a-webgl"
    }
    if let reason = p.clearedReason {
      json["cleared_reason"] = reason
      json["cleared_at"] = ago(60)
    }
    if let revision = p.revision { json["revision_request"] = revision }
    return json
  }

  private static func catalogProposal(_ p: Proposal) -> [String: Any] {
    var json: [String: Any] = [
      "id": p.id, "automation_id": p.automation, "run_id": "r-triage-2", "title": p.title,
      "summary": p.summary, "rationale": p.rationale, "confidence": p.confidence, "status": p.status,
      "recommended_action": p.cta == "open_url" ? "needs_info" : "start_session",
      "repo_root": root(p.project), "created_at": ago(120), "cta": ctaJSON(p),
    ]
    if let source = p.source {
      json["source_ref"] = ["source_id": "github", "external_id": source.label, "url": source.url]
    }
    if let sessionId = p.sessionId {
      json["session_id"] = sessionId
      json["agent_id"] = "a-webgl"
    }
    if let reason = p.clearedReason {
      json["cleared_reason"] = reason
      json["cleared_at"] = ago(60)
    }
    if let revision = p.revision { json["revision_request"] = revision }
    return json
  }

  private static var guardrailsJSON: [String: Any] {
    [
      "confidence_threshold": 0.8, "max_concurrent_sessions": 2, "max_files_changed": 25,
      "max_cost_usd_per_run": 3, "max_run_minutes": 20, "path_denylist": ["ios/Pods/**", ".env*"],
      "require_clean_ci": true, "retry_other_accounts": true,
    ]
  }

  public static let triagePlaybook = """
    # Triage new GitHub issues

    For every issue opened since the last run:

    1. Read it and any linked pull requests.
    2. Close obvious duplicates with a link to the original.
    3. For the rest, write a proposal with a confidence and a one-line rationale.

    Never comment on an issue a maintainer has already answered.
    """

  private static var triageDetail: [String: Any] {
    [
      "id": triageId, "name": "Triage new GitHub issues",
      "description": "Reads every issue opened since the last run and proposes the ones worth picking up.",
      "enabled": true, "trigger_kind": "schedule", "cron": "0 9 * * 1-5", "timezone": "Europe/Amsterdam",
      "catch_up": true, "repo_roots": [root("Argus"), root("conductor")], "source_ids": ["github"],
      "playbook": triagePlaybook, "extra_instructions": "", "autonomy": "propose", "model": "default",
      "runner": "claude-code", "guardrails": guardrailsJSON,
    ]
  }

  private static var calibration: [String: Any] {
    [
      "automation_id": triageId, "sample": 20, "accepted": 9, "auto_started": 2, "dismissed": 6,
      "pending": 2, "resolved": 1, "superseded": 0, "withdrawn": 0, "merged": 8, "abandoned": 2,
      "reverted": 0, "acceptance_rate": 0.6,
      "dismissals": [
        ["title": "Rename the settings window", "reason": "Not a bug — the name is intentional."],
        ["title": "Bump eslint to v10", "reason": "Blocked on a plugin that hasn't caught up."],
      ],
      "accepted_notes": [],
    ]
  }

  private static var memories: [[String: Any]] {
    [
      [
        "name": "maintainers.md", "description": "Who answers which label, so it never pings the wrong person",
        "type": "reference", "body": "- `area:terminal` → @dana\n- `area:git` → @sam", "updated_at": ago(600),
      ],
      [
        "name": "dont-propose-renames.md", "description": "Renames were dismissed four times; skip them",
        "type": "feedback", "body": "Skip proposals that only rename things.", "updated_at": ago(3000),
      ],
    ]
  }

  public static var reportBlocks: [[String: Any]] {
    [
      ["type": "heading", "text": "Dependency digest"],
      [
        "type": "stats",
        "items": [
          ["label": "Outdated", "value": "14", "delta": 3], ["label": "Major", "value": "2"],
          ["label": "Security", "value": "1", "delta": -1],
        ],
      ],
      [
        "type": "markdown",
        "text": "`react-native` 0.81 → 0.83 is the one to plan for: it turns the new architecture on by default.",
      ],
      [
        "type": "table", "columns": ["Package", "Current", "Latest"],
        "rows": [["react-native", "0.81.4", "0.83.1"], ["expo-av", "15.0.2", "16.1.0"], ["zod", "3.24.1", "4.1.5"]],
      ],
      [
        "type": "list",
        "items": [
          ["text": "expo-av is deprecated; move to expo-video", "tone": "warning"],
          ["text": "zod 4 is a drop-in for our usage", "tone": "positive"],
        ],
      ],
    ]
  }

  private static var runDetail: [String: Any] {
    let run = gatewayRun(runRecords[1])
    return [
      "run": run, "report_blocks": reportBlocks,
      "feedback": [
        [
          "id": "f1", "note": "Don't list dev-only packages next time.", "allow_clearing": false,
          "created_at": ago(40),
        ]
      ],
    ]
  }

  private static var sources: [[String: Any]] {
    [
      ["id": "github", "label": "GitHub issues and PRs", "mode": "native", "available": true],
      ["id": "linear", "label": "Linear", "mode": "agent", "available": true],
      ["id": "sentry", "label": "Sentry", "mode": "agent", "available": false],
    ]
  }

  private static var sessions: String {
    GalleryJSON.encode([
      "sessions": [
        [
          "id": "s-webgl", "repo_root": root("Argus"), "kind": "worktree", "branch": "terminal-webgl",
          "display_name": "Upgrade the terminal renderer to WebGL", "status": "ready",
        ]
      ]
    ])
  }

  public static var claudeAccounts: String {
    GalleryJSON.encode([
      "active_id": "work",
      "accounts": [
        [
          "id": "work", "label": "Work", "email": "dev@acme.example", "org_name": "Acme",
          "subscription_type": "max", "needs_reauth": false, "rate_limited": false, "account_type": "claudeai",
        ],
        [
          "id": "personal", "label": "Personal", "email": "dev@example.com", "subscription_type": "pro",
          "needs_reauth": false, "rate_limited": true, "account_type": "claudeai",
        ],
      ],
    ])
  }

  /// Everything the automation, run, quick-run and inbox screens read.
  /// `empty` answers every list with nothing.
  public static func automations(empty: Bool = false) -> [String: String] {
    let runs = empty ? [] : runRecords
    let proposals = empty ? [] : proposalRecords
    let automations = empty ? [] : automationRecords
    return composer.merging([
      RemoteMethod.projectsList.rawValue: GalleryJSON.projects(GalleryJSON.someProjects),
      RemoteMethod.sessionsList.rawValue: sessions,
      RemoteMethod.automationsList.rawValue: GalleryJSON.encode(["automations": automations.map(automationJSON)]),
      RemoteMethod.automationsRuns.rawValue: GalleryJSON.encode(["runs": runs.map(gatewayRun)]),
      RemoteMethod.automationsScratchRuns.rawValue: GalleryJSON.encode([
        "runs": runs.filter(\.quick).map(gatewayRun)
      ]),
      RemoteMethod.automationsRun.rawValue: GalleryJSON.encode(runDetail),
      RemoteMethod.automationsGet.rawValue: GalleryJSON.encode(["automation": triageDetail]),
      RemoteMethod.automationsSources.rawValue: GalleryJSON.encode(["sources": sources]),
      RemoteMethod.automationsMemories.rawValue: GalleryJSON.encode(["memories": empty ? [] : memories]),
      RemoteMethod.automationsCalibration.rawValue: GalleryJSON.encode(calibration),
      RemoteMethod.automationsMarkRunRead.rawValue: GalleryJSON.encode([:]),
      RemoteMethod.proposalsList.rawValue: GalleryJSON.encode(["proposals": proposals.map(gatewayProposal)]),
      RemoteMethod.proposalsGet.rawValue: GalleryJSON.encode(["proposal": gatewayProposal(proposalRecords[0])]),
      ArgusProtocol.Commands.ProposalsList.name: GalleryJSON.encode(proposals.map(catalogProposal)),
      ArgusProtocol.Commands.AutomationRunsList.name: GalleryJSON.encode(runs.map(catalogRun)),
      ArgusProtocol.Commands.AutomationCalibration.name: GalleryJSON.encode(calibration),
      ArgusProtocol.Commands.GetSession.name: "null",
      RemoteMethod.claudeAccountsList.rawValue: claudeAccounts,
    ]) { _, new in new }
  }
}

/// Plan limits for two accounts (one near its cap, one that failed to answer)
/// and a week of cost and tokens.
extension GalleryFixtures {
  public static var usage: [String: String] {
    let now = Date().timeIntervalSince1970 * 1000
    let day = 86_400_000.0
    let limits: [String: Any] = [
      "accounts": [
        [
          "account_id": "work", "label": "Work (Max)", "status": "ok", "subscription_type": "max",
          "checked_at": now - 60_000,
          "windows": [
            [
              "id": "session", "kind": "session", "label": "Current session", "used_percent": 86,
              "resets_at": now + 2.2 * 3_600_000, "window_minutes": 300,
            ],
            [
              "id": "weekly", "kind": "weekly", "label": "This week, all models", "used_percent": 41,
              "resets_at": now + 3.5 * day, "window_minutes": 10_080,
            ],
            [
              "id": "weekly-opus", "kind": "weekly", "label": "This week, Opus", "used_percent": 100,
              "resets_at": now + 3.5 * day, "window_minutes": 10_080,
            ],
          ],
        ],
        [
          "account_id": "personal", "label": "Personal", "status": "failed", "checked_at": now - 600_000,
          "windows": [],
        ],
      ]
    ]
    let costs = [3.1, 7.4, 2.2, 0.4, 9.8, 12.6, 5.3]
    let summary: [String: Any] = [
      "range": "30d", "since": now - 30 * day, "until": now, "bucket": "day", "sessions": 64,
      "tokens": [
        "processed": 182_400_000, "input": 1_200_000, "cache_read": 168_000_000, "cache_write": 11_000_000,
        "output": 2_200_000,
      ],
      "cost": ["total": 40.8, "input": 3.6, "cache_read": 16.8, "cache_write": 13.7, "output": 6.7],
      "cache_savings_usd": 151.2,
      "series": (0..<30).map { index in
        let cost = costs[index % costs.count] * (0.6 + Double(index % 5) * 0.1)
        return ["start": now - Double(30 - index) * day, "tokens": cost * 4_400_000, "cost_usd": cost]
      },
      "models": [
        ["model": "claude-opus-5-5", "tokens": 121_000_000, "cost_usd": 31.2, "priced": true],
        ["model": "claude-sonnet-5-5", "tokens": 58_000_000, "cost_usd": 9.1, "priced": true],
        ["model": "claude-haiku-5-5", "tokens": 3_400_000, "cost_usd": 0.5, "priced": true],
      ],
      "prices_fetched_at": now - day,
    ]
    return [
      RemoteMethod.usageLimits.rawValue: GalleryJSON.encode(limits),
      RemoteMethod.usageSummary.rawValue: GalleryJSON.encode(summary),
    ]
  }

  /// What the notifications screens list: a repeated error and a warning.
  @MainActor public static func notifications(into log: NotificationsLog) {
    log.clear()
    log.push(.warning, "Linear isn't connected, so the backlog automation skipped its run.", source: "automations")
    log.push(.error, "Couldn't read the inbox: the host stopped answering.", source: "proposals")
    log.push(.error, "Couldn't read the inbox: the host stopped answering.", source: "proposals")
    log.push(
      .error,
      "git worktree add failed: fatal: '/Users/dev/.argus/worktrees/Argus-argus-worktrees/fix-crash' already exists",
      source: "sessions")
  }
}
