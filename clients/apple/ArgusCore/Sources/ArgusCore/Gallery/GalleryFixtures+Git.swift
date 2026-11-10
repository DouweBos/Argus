import ArgusKit
import Foundation

/// The phone's replies for `GalleryGit`'s repository, and the pull requests
/// both apps read, so the Mac's git panel and the phone's screens show the same work.
extension GalleryFixtures {
  private static var now: Double { Date().timeIntervalSince1970 * 1000 }
  private static func ago(hours: Double) -> Double { now - hours * 3_600_000 }
  private static func iso(hours: Double) -> String {
    ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: ago(hours: hours) / 1000))
  }

  /// `(hash, subject, author, hours ago)`, newest first.
  typealias Commit = (hash: String, subject: String, author: String, hours: Double)

  static let mainLog: [Commit] = [
    ("150617ae873938e2399fff477257013727b5f1b8", "feat(remote): pair a phone over the gateway", "Maya Chen", 3),
    ("dfbfa725d7c14818e1a0d4c2420f7087b60164a6", "perf(git): read status once per refresh", "Maya Chen", 96),
    ("a62e423bffe01edba6fcb414deb6bf1b8ec0d165", "docs: explain how worktrees are laid out", "Priya Raman", 150),
    ("be0f64aa5da08bb03468cd5b4597dee33a4282d2", "feat(session): merge a session back into its base branch", "Maya Chen", 200),
    ("6d468f0ad87604e8d22bbbd216e507a57c8d7b83", "feat(terminal): spawn shells through node-pty", "Jonas Weber", 260),
    ("fb44f7e8bd3b5cd2c780302a632316b2bee3d8c6", "feat(session): create worktrees outside the project directory", "Jonas Weber", 310),
    ("70dd8c9ff1e2cf51aafbc5a1fb8d8e8e65998220", "chore: initial commit", "Maya Chen", 340),
  ]

  static let branchOnly: [Commit] = [
    ("8d716d239ae7bf4476a97a0fc265aee65d5e4b75", "refactor(session): name the default strategy", "Argus Agent", 20),
    ("e9b6dde29c9f5bfc9dda6b9d553fa426115891ba", "test(session): cover squash merges", "Argus Agent", 48),
    ("dd3aa7d2cffa39cdffdbaa57db76e984d9dfdb7a", "feat(session): pick a merge strategy per project", "Argus Agent", 50),
  ]

  public static func gitSession(_ id: String, path: String) -> [String: Any] {
    let root = id == GalleryGit.rootSessionId
    return [
      "id": id, "repo_root": GalleryGit.repoRoot, "kind": root ? "project_root" : "worktree",
      "branch": root ? "main" : GalleryGit.branch, "base_branch": "main", "status": "ready",
      "display_name": root ? "luma" : "Merge strategy", "path": path, "description": "",
    ]
  }

  /// Everything the git screens ask for. `path` is where the Mac's repository is.
  public static func git(sessionId: String, path: String = GalleryGit.repoRoot) -> [String: String] {
    let session = gitSession(sessionId, path: path)
    return [
      RemoteMethod.sessionsList.rawValue: GalleryJSON.encode(["sessions": [session]]),
      RemoteMethod.sessionsBranches.rawValue: GalleryJSON.encode(["branches": branches]),
      RemoteMethod.sessionsBranchLog.rawValue: GalleryJSON.encode([
        "commits": (sessionId == GalleryGit.rootSessionId ? mainLog : branchOnly + mainLog.dropFirst()).map(commit)
      ]),
      RemoteMethod.sessionsCompareBranches.rawValue: GalleryJSON.encode([
        "left_only": mainLog.prefix(1).map(summary), "right_only": branchOnly.map(summary),
        "merge_base": mainLog[1].hash, "would_conflict": false,
      ]),
      RemoteMethod.sessionsDiff.rawValue: GalleryJSON.encode(["diff": GalleryGit.workingDiff, "base_branch": "main"]),
      RemoteMethod.sessionsCommitDiff.rawValue: GalleryJSON.encode(["diff": GalleryGit.commitDiff]),
      RemoteMethod.sessionsStashes.rawValue: GalleryJSON.encode(["stashes": stashes]),
      RemoteMethod.sessionsTags.rawValue: GalleryJSON.encode(["tags": tags]),
      RemoteMethod.sessionsGitStatus.rawValue: GalleryJSON.encode(["status": status(sessionId)]),
      ArgusProtocol.Commands.GetSession.name: GalleryJSON.encode(session),
      RemoteMethod.sessionsCommitIdentity.rawValue: GalleryJSON.encode([
        "name": "Maya Chen", "email": "maya.chen@example.com", "can_sign": false,
      ]),
      RemoteMethod.sessionsMergeBlockers.rawValue: GalleryJSON.encode(["blockers": [String]()]),
      RemoteMethod.agentsStopped.rawValue: GalleryJSON.encode(["agents": []]),
      ArgusProtocol.Commands.GetUserProjectSettings.name: GalleryJSON.encode(["pinnedBranches": ["chore/node-24"]]),
      ArgusProtocol.Commands.ListEditors.name: "[]",
      ArgusProtocol.Commands.GitListArchivedBranches.name: "[]",
      ArgusProtocol.Commands.GitListPinnedBranches.name: GalleryJSON.encode(["chore/node-24"]),
      ArgusProtocol.Commands.ReadArgusConfig.name: GalleryJSON.encode([
        "setup": ["copy": [], "symlink": [], "commands": []], "terminals": [], "workspaceEnv": [], "run": [],
        "browserPresets": [], "protectedBranches": ["main"], "releaseNotePatterns": [], "simulatorDeeplinks": [],
      ]),
    ]
  }

  private static func commit(_ c: Commit) -> [String: Any] {
    [
      "hash": c.hash, "short_hash": String(c.hash.prefix(7)), "subject": c.subject, "body": "",
      "author": c.author, "date": iso(hours: c.hours), "refs": "",
    ]
  }

  private static func summary(_ c: Commit) -> [String: Any] {
    ["hash": c.hash, "subject": c.subject, "author": c.author, "timestamp": ago(hours: c.hours)]
  }

  private static func status(_ sessionId: String) -> [String: Any] {
    let root = sessionId == GalleryGit.rootSessionId
    return [
      "branch": root ? "main" : GalleryGit.branch, "upstream": root ? "origin/main" : "origin/\(GalleryGit.branch)",
      "ahead": 1, "behind": 0, "dirty_count": root ? 0 : 5, "stash_count": 3, "conflict_count": 0,
      "detached": false, "diff_additions": 22, "diff_deletions": 7,
    ]
  }

  private static var branches: [[String: Any]] {
    func local(
      _ name: String, current: Bool = false, upstream: Bool = true, ahead: Int = 0, behind: Int = 0,
      _ subject: String, hours: Double, pinned: Bool = false
    ) -> [String: Any] {
      var branch: [String: Any] = [
        "name": name, "scope": "local", "is_current": current, "ahead": ahead, "behind": behind,
        "last_commit_subject": subject, "last_commit_at": ago(hours: hours), "pinned": pinned,
      ]
      if upstream { branch["upstream"] = "origin/\(name)" }
      return branch
    }
    func remote(_ name: String, _ subject: String, hours: Double) -> [String: Any] {
      [
        "name": name, "scope": "remote", "remote": "origin", "is_current": false, "ahead": 0, "behind": 0,
        "last_commit_subject": subject, "last_commit_at": ago(hours: hours),
      ]
    }
    return [
      local("main", current: true, ahead: 1, mainLog[0].subject, hours: 3),
      local("chore/node-24", ahead: 1, behind: 1, "chore: pin node 24.11", hours: 40, pinned: true),
      local(
        "argus/move-the-diff-parser-into-its-own-module-with-tests-and-docs", upstream: false,
        "refactor(git): move the diff parser into its own module", hours: 6),
      local(GalleryGit.branch, ahead: 1, branchOnly[0].subject, hours: 20),
      local(
        "fix/terminal-resize-flicker", upstream: false, "fix(terminal): debounce resize events while the window drags",
        hours: 12),
      remote("dependabot/npm_and_yarn/vite-7.1.4", "build(deps-dev): bump vite from 7.1.2 to 7.1.4", hours: 30),
      remote("release/0.72", "chore(release): 0.72.0", hours: 90),
    ]
  }

  private static var stashes: [[String: Any]] {
    [
      ("6d13504f5ccba6135929e6b886d8de20d173977b", "On main: try a shorter fetch interval", 1.0, mainLog[0].hash),
      ("874ec34c011a3680f5713ef2133913d2d1ec41bd", "On feat/merge-strategy: half-done strategy picker", 2,
        branchOnly[0].hash),
      ("dd221f2ee6e9416b7d13eab62dc65eb6e9272cf5", "On main: debug logging for the gateway", 2.5, mainLog[0].hash),
    ].enumerated().map { index, stash in
      [
        "index": index, "hash": stash.0, "author": "Maya Chen", "authorEmail": "maya.chen@example.com",
        "date": iso(hours: stash.2), "parentHash": stash.3, "message": stash.1,
      ]
    }
  }

  private static var tags: [[String: Any]] {
    [
      [
        "name": "v0.72.1", "commitHash": mainLog[0].hash, "subject": mainLog[0].subject, "isAnnotated": false,
        "creatorDate": iso(hours: 3), "pushed": false,
      ],
      [
        "name": "v0.72.0", "commitHash": mainLog[1].hash, "subject": mainLog[1].subject, "isAnnotated": true,
        "message": "luma 0.72.0", "creatorDate": iso(hours: 96), "pushed": true,
        "tagger": ["name": "Maya Chen", "email": "maya.chen@example.com", "date": iso(hours: 96)],
      ],
      [
        "name": "v0.71.0", "commitHash": mainLog[3].hash, "subject": mainLog[3].subject, "isAnnotated": false,
        "creatorDate": iso(hours: 200), "pushed": true,
      ],
    ]
  }
}
