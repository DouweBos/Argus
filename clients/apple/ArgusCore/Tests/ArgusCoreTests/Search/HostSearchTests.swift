import ArgusCore
import ArgusKit
import Foundation
import Testing

private func decode<T: Decodable>(_ type: T.Type, _ json: [String: Any]) -> T {
  try! JSONDecoder().decode(T.self, from: JSONSerialization.data(withJSONObject: json))
}

private let agent = HostSearch.agent(
  decode(
    RemoteAgentStatus.self,
    [
      "agent_id": "a1", "session_id": "s1", "status": "running", "title": "Fix login redirect",
      "project_name": "Storefront", "session_label": "checkout-flow",
    ]),
  repoRoot: "/r/storefront")

private let session = HostSearch.session(
  decode(
    RemoteSession.self,
    ["id": "s2", "kind": "worktree", "branch": "feat/new-settings", "repo_root": "/r/argus", "status": "ready",
     "display_name": "Settings redesign"]),
  place: "Argus")

private let teammate = HostSearchResult(
  kind: .teammate, itemId: "t1", title: "Reviewer", subtitle: "@rex · Reads every pull request",
  keywords: ["rex", "Reads every pull request"], sessionId: nil, repoRoot: nil, route: .teammate(id: "t1"))

@Suite("Host search")
struct HostSearchTests {
  private let items = [agent, session, teammate]

  @Test("an empty query matches nothing")
  func emptyQuery() {
    #expect(HostSearch.results("  ", in: items).isEmpty)
  }

  @Test("matches names, branches, projects and handles")
  func matchesEveryText() {
    #expect(HostSearch.results("login", in: items).map(\.id) == ["agent:a1"])
    #expect(HostSearch.results("new-settings", in: items).map(\.id) == ["session:s2"])
    #expect(HostSearch.results("storefront", in: items).map(\.id) == ["agent:a1"])
    #expect(HostSearch.results("rex", in: items).map(\.id) == ["teammate:t1"])
  }

  @Test("word starts rank first, as in the command palette")
  func ranksLikeThePalette() {
    let ranked = HostSearch.results("set", in: items)
    #expect(ranked.first?.id == "session:s2")
  }

  @Test("each result opens its own route")
  func routes() {
    #expect(agent.route == .session(id: "s1", agentId: "a1"))
    #expect(session.route == .session(id: "s2", agentId: nil))
    #expect(teammate.route == .teammate(id: "t1"))
  }

  @Test("groups results by kind, best kind first, and drops duplicates")
  func groupsByKind() {
    let results = HostSearch.results("r", in: items + [agent])
    #expect(results.filter { $0.id == "agent:a1" }.count == 1)
    let groups = HostSearch.grouped(results)
    #expect(Set(groups.map(\.kind)) == Set(results.map(\.kind)))
    #expect(groups.first?.kind == results.first?.kind)
  }

  @Test("a session's subtitle names where it works and its branch")
  func sessionSubtitle() {
    #expect(session.title == "Settings redesign")
    #expect(session.subtitle == "Argus · feat/new-settings")
  }
}
