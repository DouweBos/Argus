import ArgusKit
import Foundation

/// Pull requests across a few repositories, in every review state, and one in
/// full: the phone's `github.*` replies and the Mac's `get_pull_request_*`.
extension GalleryFixtures {
  private static func iso(daysAgo: Double) -> String {
    ISO8601DateFormatter().string(from: Date().addingTimeInterval(-daysAgo * 86_400))
  }

  /// `(number, repo, title, author, draft, decision, head, reasons, days ago)`.
  private static let pullRequestRows:
    [(Int, String, String, String, Bool, String?, String, [String], Double)] = [
      (482, "acme/luma", "Pick a merge strategy per project", "argus-agent", false, "REVIEW_REQUIRED",
        GalleryGit.branch, ["author"], 0.1),
      (479, "acme/luma", "Debounce terminal resize events while the window drags", "jonas-weber", false, nil,
        "fix/terminal-resize-flicker", ["reviewer"], 0.4),
      (1203, "acme/conductor",
        "Stream simulator logs over the gateway without dropping frames on slow or metered networks",
        "priya-raman", false, "REVIEW_REQUIRED", "priya/stream-sim-logs", ["team"], 1),
      (470, "acme/luma", "Move the diff parser into its own module", "maya-chen", false, "CHANGES_REQUESTED",
        "argus/move-the-diff-parser-into-its-own-module-with-tests-and-docs", ["author"], 2),
      (88, "acme/site", "Publish the routing docs", "maya-chen", false, "APPROVED", "docs/routing", ["author"], 3),
      (465, "acme/luma", "Pair over Bluetooth when the phone and Mac share no network", "maya-chen", true, nil,
        "maya/bluetooth-pairing", ["author"], 6),
      (301, "acme/grove", "Fix rebase todo parsing with empty lines", "sam-okafor", false, "REVIEW_REQUIRED",
        "fix/rebase-todo", ["mentioned", "commenter"], 9),
    ]

  public static var pullRequestList: [[String: Any]] {
    pullRequestRows.map { number, repo, title, author, draft, decision, head, reasons, days in
      var row: [String: Any] = [
        "number": number, "title": title, "repo": repo, "repo_root": "/Users/dev/Projects/\(repo.split(separator: "/")[1])",
        "author": author, "is_draft": draft, "head_ref": head, "base_ref": "main",
        "url": "https://github.com/\(repo)/pull/\(number)", "updated_at": iso(daysAgo: days), "reasons": reasons,
      ]
      if let decision { row["review_decision"] = decision }
      return row
    }
  }

  static let pullRequestBody = """
    Sessions merge with the project's chosen strategy instead of always making a merge commit.

    - **Squash** by default, so a session lands as one commit
    - Rebase and merge commits stay available in Project Settings
    - Hooks still run before the merge, so a failing check stops it

    Closes #451.
    """

  private static let checks: [(String, String, String?)] = [
    ("build (macos-15)", "completed", "success"),
    ("lint", "completed", "success"),
    ("test (node 24)", "in_progress", nil),
    ("e2e (chromium)", "completed", "failure"),
  ]

  private static let conversation: [(String, String, String, String?, Double)] = [
    ("c1", "priya-raman", "Does this also cover sessions whose worktree has uncommitted changes?", nil, 0.08),
    ("c2", "jonas-weber",
      "Looks good overall. Squash as the default is right, but the e2e failure looks real: the merge sheet still says *Merge commit*.",
      "COMMENTED", 0.05),
  ]

  /// What both apps read for the PR list, `#482` in full, and its diff.
  public static var pullRequests: [String: String] {
    [
      RemoteMethod.sessionsList.rawValue: GalleryJSON.encode(["sessions": []]),
      RemoteMethod.githubPullRequests.rawValue: GalleryJSON.encode(["pull_requests": pullRequestList]),
      RemoteMethod.githubPullRequest.rawValue: GalleryJSON.encode(["pull_request": phoneDetail]),
      ArgusProtocol.Commands.GetPullRequestDetail.name: GalleryJSON.encode(macDetail),
      ArgusProtocol.Commands.GetPullRequestDiff.name: jsonString(GalleryGit.workingDiff),
      RemoteMethod.githubPullRequestDiff.rawValue: GalleryJSON.encode(["diff": GalleryGit.workingDiff]),
      RemoteMethod.githubPullRequestViewedFiles.rawValue: GalleryJSON.encode(["files": viewedFiles]),
    ]
  }

  /// Review half done: one file viewed, one pushed to since.
  public static let viewedFiles: [[String: String]] = [
    ["path": "README.md", "state": "viewed"],
    ["path": "src/session/merge.ts", "state": "changed"],
  ]

  /// A bare JSON string, as a command answering `String` replies.
  private static func jsonString(_ text: String) -> String {
    (try? JSONEncoder().encode(text)).flatMap { String(data: $0, encoding: .utf8) } ?? "\"\""
  }

  private static var phoneDetail: [String: Any] {
    [
      "number": 482, "title": "Pick a merge strategy per project", "repo": "acme/luma",
      "url": "https://github.com/acme/luma/pull/482", "author": "argus-agent", "body": pullRequestBody,
      "state": "OPEN", "is_draft": false, "merged": false, "mergeable": "MERGEABLE", "head_ref": GalleryGit.branch,
      "base_ref": "main", "additions": 22, "deletions": 7, "changed_files": 4,
      "checks": checks.map { name, status, conclusion in
        var check: [String: Any] = ["name": name, "status": status]
        if let conclusion { check["conclusion"] = conclusion }
        return check
      },
      "comments": conversation.map { id, author, body, state, days in
        var comment: [String: Any] = [
          "id": id, "author": author, "body": body, "created_at": iso(daysAgo: days),
          "kind": state == nil ? "issue" : "review",
        ]
        if let state { comment["review_state"] = state }
        return comment
      },
    ]
  }

  private static var macDetail: [String: Any] {
    [
      "number": 482, "title": "Pick a merge strategy per project", "repoNameWithOwner": "acme/luma",
      "repoUrl": "https://github.com/acme/luma", "url": "https://github.com/acme/luma/pull/482",
      "author": "argus-agent", "body": pullRequestBody, "bodyHtml": "", "state": "OPEN", "isDraft": false,
      "merged": false, "mergeable": "MERGEABLE", "headRefName": GalleryGit.branch, "baseRefName": "main",
      "additions": 22, "deletions": 7, "changedFiles": 4, "commits": 3, "labels": ["enhancement"],
      "createdAt": iso(daysAgo: 2), "updatedAt": iso(daysAgo: 0.05),
      "checks": checks.map { name, status, conclusion in
        var check: [String: Any] = ["name": name, "status": status]
        if let conclusion { check["conclusion"] = conclusion }
        return check
      },
      "comments": conversation.map { id, author, body, state, days in
        var comment: [String: Any] = [
          "id": id, "author": author, "body": body, "bodyHtml": "", "createdAt": iso(daysAgo: days),
          "kind": state == nil ? "issue" : "review", "url": "https://github.com/acme/luma/pull/482#\(id)",
        ]
        if let state { comment["reviewState"] = state }
        return comment
      },
      "commitList": GalleryFixtures.branchOnly.reversed().map { commit in
        [
          "oid": commit.hash, "abbreviatedOid": String(commit.hash.prefix(7)), "author": commit.author,
          "committedDate": iso(daysAgo: commit.hours / 24), "message": commit.subject,
          "url": "https://github.com/acme/luma/commit/\(commit.hash)",
        ]
      },
      "files": [
        ["path": "README.md", "changeType": "MODIFIED", "additions": 2, "deletions": 0],
        ["path": "src/legacy/bridge.ts", "changeType": "DELETED", "additions": 0, "deletions": 3],
        ["path": "src/session/merge.ts", "changeType": "MODIFIED", "additions": 9, "deletions": 4],
        ["path": "src/session/strategy.test.ts", "changeType": "ADDED", "additions": 8, "deletions": 0],
      ],
    ]
  }
}
