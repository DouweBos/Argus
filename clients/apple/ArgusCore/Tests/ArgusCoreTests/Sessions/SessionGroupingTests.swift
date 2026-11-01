import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

private func session(
  _ id: String, kind: String = "worktree", status: String = "ready", name: String? = nil,
  setupError: String? = nil, unavailable: Bool = false
) -> RemoteSession {
  var json: [String: Any] = [
    "id": id, "repo_root": "/r", "kind": kind, "branch": "b-\(id)", "status": status,
  ]
  json["display_name"] = name
  json["setup_error"] = setupError
  if unavailable { json["availability"] = "unavailable" }
  return try! JSONDecoder().decode(RemoteSession.self, from: JSONSerialization.data(withJSONObject: json))
}

private func agent(
  _ id: String, session: String = "s1", status: String = "idle", created: Double = 0,
  active: Double? = nil, awaiting: String? = nil
) -> RemoteAgentStatus {
  var json: [String: Any] = ["agent_id": id, "session_id": session, "status": status, "created_at": created]
  json["last_activity_at"] = active
  json["awaiting"] = awaiting
  return try! JSONDecoder().decode(RemoteAgentStatus.self, from: JSONSerialization.data(withJSONObject: json))
}

@Suite("Session activity")
struct SessionActivityTests {
  @Test("a ready session reads as idle, working or waiting by its agents")
  func readyStates() {
    let ready = session("s1")
    #expect(SessionActivity(session: ready, agents: []).state == .idle)
    #expect(SessionActivity(session: ready, agents: [agent("a", status: "running")]).state == .working)
    #expect(
      SessionActivity(session: ready, agents: [agent("a", status: "running", awaiting: "permission")]).state == .waiting)
    #expect(!SessionActivity(session: ready, agents: [agent("a")]).showsDot)
    #expect(SessionActivity(session: ready, agents: [agent("a")]).statusText == "1 agent")
  }

  @Test("setup, removal and failure say so, not the raw status")
  func lifecycle() {
    let setting = SessionActivity(session: session("s1", status: "initializing"), agents: [])
    #expect(setting.state == .preparing && setting.showsDot && setting.isBusy)
    #expect(setting.statusText == "Setting up…")
    #expect(SessionActivity(session: session("s1", status: "deleting"), agents: []).statusText == "Deleting…")
    #expect(!SessionActivity(session: session("s1", status: "deleting"), agents: []).showsDot)
    let failed = SessionActivity(session: session("s1", status: "error", setupError: "npm failed"), agents: [])
    #expect(failed.state == .failed && failed.statusText == "npm failed")
    #expect(SessionActivity.statusLabel(.error) == "Setup failed")
    #expect(SessionActivity.statusLabel(.ready) == nil)
  }

  @Test("a missing drive outranks everything")
  func unavailable() {
    let activity = SessionActivity(
      session: session("s1", status: "error", unavailable: true), agents: [agent("a", status: "running")])
    #expect(activity.state == .unavailable)
  }

  @Test("last active is the latest agent activity, else its creation")
  func lastActive() {
    let activity = SessionActivity(
      session: session("s1"), agents: [agent("a", created: 5), agent("b", created: 1, active: 9)])
    #expect(activity.lastActive == 9)
  }
}

@Suite("Agent order")
struct AgentOrderTests {
  @Test("⇧⌘] and ⇧⌘[ wrap around the session's agents")
  func wraps() {
    let ids = ["a", "b", "c"]
    #expect(AgentOrder.cycled(ids, from: "a", by: 1) == "b")
    #expect(AgentOrder.cycled(ids, from: "c", by: 1) == "a")
    #expect(AgentOrder.cycled(ids, from: "a", by: -1) == "c")
  }

  @Test("nothing to switch to with one agent, or none in front")
  func nothingToCycle() {
    #expect(AgentOrder.cycled(["a"], from: "a", by: 1) == nil)
    #expect(AgentOrder.cycled(["a", "b"], from: nil, by: 1) == nil)
    #expect(AgentOrder.cycled(["a", "b"], from: "gone", by: 1) == nil)
  }

  @Test("the live status is laid over before sorting by activity")
  func overlayBeforeSort() {
    let listed = [agent("a", status: "idle", active: 10), agent("b", status: "idle", active: 5)]
    let live = ["b": agent("b", status: "running", active: 5)]
    let sorted = AgentOrder.byActivity(AgentOrder.overlaid(listed, live: live))
    #expect(sorted.map(\.agentId) == ["b", "a"])
    #expect(sorted.first?.status == .running)
  }

  @Test("waiting on you outranks running, running outranks recent")
  func byActivity() {
    let agents = [
      agent("idle", active: 100), agent("run", status: "running", active: 1),
      agent("ask", status: "running", active: 0, awaiting: "question"),
    ]
    #expect(AgentOrder.byActivity(agents).map(\.agentId) == ["ask", "run", "idle"])
  }

  @Test("a kept agent that stopped keeps its tab, in creation order; others drop")
  func sessionTabsKeepStopped() {
    let listed = [agent("live", created: 2), agent("old", created: 0)]
    let stopped = ["shut": agent("shut", status: "stopped", created: 1), "old": agent("old", status: "stopped")]
    let tabs = AgentOrder.sessionTabs(
      listed: listed, kept: ["shut"], status: { stopped[$0] }, isGone: { stopped[$0] != nil })
    #expect(tabs.map(\.agentId) == ["shut", "live"])
  }

  @Test("closing a tab hands focus to the one before it, else after")
  func neighbour() {
    #expect(AgentOrder.neighbour(of: "b", in: ["a", "b", "c"]) == "a")
    #expect(AgentOrder.neighbour(of: "a", in: ["a", "b"]) == "b")
    #expect(AgentOrder.neighbour(of: "a", in: ["a"]) == nil)
  }
}

@Suite("Session groups")
struct SessionGroupTests {
  @Test("project root first, then sessions in host order, then ones only agents mention")
  func order() {
    let sessions = [session("w1"), session("root", kind: "project_root"), session("w2", name: "Two")]
    let agents = [agent("x", session: "gone"), agent("a", session: "w2")]
    let groups = SessionGroup.make(sessions: sessions, agents: agents)
    #expect(groups.map(\.id) == ["root", "w1", "w2", "gone"])
    #expect(groups[2].label == "Two")
    #expect(groups[3].label == "Session" && groups[3].session == nil)
  }

  @Test("a session's agents are oldest first, live status laid over")
  func agentsInSession() {
    let agents = [agent("late", session: "w1", created: 2), agent("early", session: "w1", created: 1)]
    let live = ["late": agent("late", session: "w1", status: "running", created: 2)]
    let group = SessionGroup.make(sessions: [session("w1")], agents: agents, live: live)[0]
    #expect(group.agents.map(\.agentId) == ["early", "late"])
    #expect(group.agents[1].status == .running)
  }
}

@Suite("Session search")
struct SessionSearchTests {
  @Test("matches by title, branch or project; an empty query matches nothing")
  func matches() {
    let s = session("1", name: "Fix login")
    #expect(SessionSearch.matches(s, projectName: "Argus", query: "LOGIN"))
    #expect(SessionSearch.matches(s, projectName: "Argus", query: "b-1"))
    #expect(SessionSearch.matches(s, projectName: "Argus", query: "argus"))
    #expect(!SessionSearch.matches(s, projectName: "Argus", query: "  "))
  }

  @Test("worktrees: the search's matches, else all unless folded")
  func visible() {
    let worktrees = [session("a"), session("b")]
    #expect(SessionSearch.visibleWorktrees(worktrees, shown: nil, collapsed: false).count == 2)
    #expect(SessionSearch.visibleWorktrees(worktrees, shown: nil, collapsed: true).isEmpty)
    #expect(SessionSearch.visibleWorktrees(worktrees, shown: ["b"], collapsed: true).map(\.id) == ["b"])
  }

  @Test("ordered keeps the original order within a rank, unknown keys last")
  func ordered() {
    let items = [("p1", "h2"), ("p2", "x"), ("p3", "h1"), ("p4", "h2")]
    let sorted = SessionSearch.ordered(items, by: ["h1", "h2"]) { $0.1 }
    #expect(sorted.map(\.0) == ["p3", "p1", "p4", "p2"])
  }
}

@Suite("Upstream text")
struct GitUpstreamTextTests {
  private func git(upstream: String?, ahead: Int = 0, behind: Int = 0) -> RemoteGitStatus {
    var json: [String: Any] = [
      "branch": "main", "ahead": ahead, "behind": behind, "dirty_count": 0, "stash_count": 0,
      "conflict_count": 0, "detached": false,
    ]
    json["upstream"] = upstream
    return try! JSONDecoder().decode(RemoteGitStatus.self, from: JSONSerialization.data(withJSONObject: json))
  }

  @Test("not pushed, up to date, or ahead and behind")
  func describe() {
    #expect(GitUpstreamText.describe(git(upstream: nil)) == "Not pushed")
    #expect(GitUpstreamText.describe(git(upstream: "origin/main")) == "Up to date with origin/main")
    #expect(GitUpstreamText.describe(git(upstream: "origin/main", ahead: 2, behind: 1)) == "↑2 ↓1 origin/main")
    #expect(!GitUpstreamText.isNoteworthy(git(upstream: "origin/main")))
  }
}

@Suite("Status words")
struct StatusWordTests {
  @Test("one vocabulary for every screen")
  func words() {
    #expect(Labels.statusLabel(.error) == "error")
    #expect(Labels.statusLabel(.stopped) == "stopped")
    #expect(Labels.statusLabel(.requiresAction) == "needs input")
  }
}

@MainActor
@Suite("Host store grouping")
struct HostStoreGroupingTests {
  private func project(_ root: String, _ name: String) -> RemoteProject {
    try! JSONDecoder().decode(RemoteProject.self, from: Data(#"{"repo_root": "\#(root)", "name": "\#(name)"}"#.utf8))
  }

  @Test("an agent is placed by its session, by name only while sessions are unknown and the name is unique")
  func placement() {
    let store = HostStore()
    store.projects = [project("/r", "app"), project("/other", "app"), project("/solo", "solo")]
    var a = agent("a", session: "s1")
    a.projectName = "app"
    var b = agent("b", session: "x")
    b.projectName = "solo"
    store.recentAgents = [a, b]
    // Two projects called "app": no guessing until the sessions say.
    #expect(store.agents(inProject: "/r").isEmpty)
    #expect(store.agents(inProject: "/solo").map(\.agentId) == ["b"])
    store.sessionsByRepo["/r"] = [session("s1")]
    #expect(store.agents(inProject: "/r").map(\.agentId) == ["a"])
    #expect(store.agents(inProject: "/other").isEmpty)
  }

  @Test("recent agents sort with the live status laid over")
  func recentByActivity() {
    let store = HostStore()
    store.recentAgents = [agent("a", active: 10), agent("b", active: 1)]
    store.statusByAgent["b"] = agent("b", status: "running", active: 1)
    #expect(store.recentAgentsByActivity.map(\.agentId) == ["b", "a"])
  }
}
