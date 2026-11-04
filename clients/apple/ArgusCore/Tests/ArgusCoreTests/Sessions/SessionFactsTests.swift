import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

private func decode<T: Decodable>(_ json: [String: Any]) -> T {
  try! JSONDecoder().decode(T.self, from: JSONSerialization.data(withJSONObject: json))
}

private func session(
  name: String? = nil, branch: String = "fix-login", base: String? = nil, pullRequest: [String: Any]? = nil
) -> RemoteSession {
  var json: [String: Any] = ["id": "s1", "repo_root": "/r", "kind": "worktree", "branch": branch, "status": "ready"]
  json["display_name"] = name
  json["base_branch"] = base
  json["pull_request"] = pullRequest
  return decode(json)
}

private func git(
  additions: Int = 0, deletions: Int = 0, dirty: Int = 0, behind: Int = 0, conflicts: Int = 0
) -> RemoteGitStatus {
  decode([
    "branch": "fix-login", "upstream": "origin/fix-login", "ahead": 0, "behind": behind, "dirty_count": dirty,
    "stash_count": 0, "conflict_count": conflicts, "detached": false, "diff_additions": additions,
    "diff_deletions": deletions,
  ])
}

@Suite("Session facts")
struct SessionFactsTests {
  @Test("the title is the name, the subtitle the branch only when it adds something")
  func titles() {
    #expect(SessionActivity.title(session(name: "Fix login")) == "Fix login")
    #expect(SessionActivity.subtitle(session(name: "Fix login")) == "fix-login")
    #expect(SessionActivity.title(session(name: "")) == "fix-login")
    #expect(SessionActivity.subtitle(session()) == nil)
  }

  @Test("git facts appear only once the status is known, and only what applies")
  func gitFacts() {
    let activity = SessionActivity(session: session(base: "main"), agents: [])
    #expect(activity.facts(git: nil).map(\.label) == ["Base"])
    let quiet = activity.facts(git: git())
    #expect(quiet.map(\.label) == ["Base", "Changes", "Upstream"])
    #expect(quiet[1].value == .text("None"))
    let busy = activity.facts(git: git(additions: 4, deletions: 1, dirty: 1, behind: 2, conflicts: 3))
    #expect(busy.map(\.label) == ["Base", "Changes", "Uncommitted", "Upstream", "Conflicts"])
    #expect(busy[1].value == .changes(additions: 4, deletions: 1))
    #expect(busy[2].value == .text("1 file"))
    #expect(busy[3].emphasis == .warning && busy[4].emphasis == .danger)
  }

  @Test("a pull request follows the base, with its number and link")
  func pullRequestFact() {
    let pr: [String: Any] = ["number": 42, "state": "open", "url": "https://github.com/o/r/pull/42"]
    let facts = SessionActivity(session: session(base: "main", pullRequest: pr), agents: []).facts(git: nil)
    #expect(facts.map(\.label) == ["Base", "Pull request"])
    #expect(facts[1].value == .pullRequest(RemoteSessionPullRequest(number: 42, state: .open, url: "https://github.com/o/r/pull/42")))
  }
}
