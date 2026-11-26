import ArgusCore
import ArgusKit
import Foundation
import Testing

@testable import ArgusUI

@Suite("Cross-project sessions")
struct CrossProjectTests {
  private func session(_ extra: [String: Any]) throws -> RemoteSession {
    let json: [String: Any] = ["id": "s", "repo_root": "/p/api", "kind": "worktree", "branch": "b", "status": "ready"]
      .merging(extra) { _, new in new }
    return try JSONDecoder().decode(RemoteSession.self, from: JSONSerialization.data(withJSONObject: json))
  }

  private func repo(_ session: RemoteSession?) -> CrossProjectRepo {
    CrossProjectRepo(sessionId: "s", repoRoot: "/p/api", branch: "b", session: session, isPrimary: false)
  }

  @Test("a single-repo session decodes with neither field")
  func singleRepo() throws {
    let plain = try session([:])
    #expect(!plain.isCrossProject)
    #expect(!plain.isLinkedRepo)
    #expect(plain.crossProjectCaption == nil)
  }

  @Test("the primary counts its own repository in the caption")
  func caption() throws {
    let primary = try session(["linked_repos": [["session_id": "m", "repo_root": "/p/web", "branch": "b"]]])
    #expect(primary.isCrossProject)
    #expect(primary.crossProjectCaption == "2 repositories")
    #expect(try session(["cross_project_of": "p"]).isLinkedRepo)
  }

  @Test("setup comes before the pull request")
  func state() throws {
    #expect(CrossProjectRepoList.state(repo(nil))?.label == "Loading")
    #expect(CrossProjectRepoList.state(repo(try session(["status": "initializing"])))?.label == "Setting up")
    #expect(CrossProjectRepoList.state(repo(try session(["status": "error"])))?.label == "Setup failed")
    let merged = try session(["pull_request": ["number": 4, "state": "merged", "url": "u"]])
    #expect(CrossProjectRepoList.state(repo(merged))?.label == "Merged")
    #expect(CrossProjectRepoList.state(repo(try session([:]))) == nil)
  }

  @Test("the offer names every project and says it lands on its own")
  func offer() {
    #expect(CrossProjectOffer.actionLabel(count: 1) == "Add Worktree")
    #expect(CrossProjectOffer.actionLabel(count: 2) == "Add Worktrees")
    let text = CrossProjectOffer.text(names: ["api", "app"], branch: "feat/x", adding: false)
    #expect(text.contains("api"))
    #expect(text.contains("app"))
    #expect(text.contains("feat/x"))
  }
}
