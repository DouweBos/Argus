import ArgusKit
import Foundation
import Testing

@testable import Argus

@MainActor
struct SessionTitleTests {
  private func session(branch: String, name: String?) throws -> RemoteSession {
    var json: [String: Any] = ["id": "s", "repo_root": "/r", "kind": "worktree", "branch": branch, "status": "ready"]
    json["display_name"] = name
    return try JSONDecoder().decode(RemoteSession.self, from: JSONSerialization.data(withJSONObject: json))
  }

  @Test("The branch shows once when the session is named after it")
  func branchOnce() throws {
    let main = try session(branch: "main", name: nil)
    #expect(SessionView.title(main) == "main")
    #expect(SessionView.subtitle(main) == "")
    let same = try session(branch: "main", name: "main")
    #expect(SessionView.subtitle(same) == "")
    let blank = try session(branch: "fix-1", name: "")
    #expect(SessionView.title(blank) == "fix-1")
    #expect(SessionView.subtitle(blank) == "")
  }

  @Test("A named session keeps its branch underneath")
  func namedSession() throws {
    let named = try session(branch: "argus/fix-1", name: "Fix login")
    #expect(SessionView.title(named) == "Fix login")
    #expect(SessionView.subtitle(named) == "argus/fix-1")
  }
}
