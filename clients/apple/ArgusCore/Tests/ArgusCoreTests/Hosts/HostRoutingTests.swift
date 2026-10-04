import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

private func json(_ text: String) -> JSONValue {
  try! JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
}

struct HostIndexTests {
  @Test func subjectFollowsTheDesktopsPrecedence() {
    let index = HostIndex()
    index.remember(.session, "s1", host: "mini")
    index.remember(.agent, "a1", host: "box")
    index.remember(.project, "/repo", host: "box")
    // A session beats an agent beats a root.
    #expect(index.subject(of: json(#"{"sessionId":"s1","agentId":"a1"}"#)) == "mini")
    #expect(index.subject(of: json(#"{"agent_id":"a1","repo_root":"/x"}"#)) == "box")
    #expect(index.subject(of: json(#"{"repoRoot":"/repo"}"#)) == "box")
    // An unknown subject falls through to the next key.
    #expect(index.subject(of: json(#"{"sessionId":"nope","repoRoot":"/repo"}"#)) == "box")
    // A bare id names a session, agent or terminal.
    #expect(index.subject(of: json(#"{"id":"s1"}"#)) == "mini")
    #expect(index.subject(of: json(#"{"id":"other"}"#)) == nil)
  }

  @Test func learnsIdsFromListsAndEvents() {
    let index = HostIndex()
    index.learn(
      response: json(#"[{"id":"s9","repo_root":"/r","branch":"b","kind":"worktree"}]"#),
      method: "sessions.list", host: "mini")
    #expect(index.host(of: .session, "s9") == "mini")
    #expect(index.host(of: .project, "/r") == "mini")

    index.learn(
      response: json(#"{"sessions":[{"id":"s2","repoRoot":"/q"}],"agents":[{"agent_id":"a2"}],"projects":[{"path":"/p"}]}"#),
      method: "state_hydrate", host: "box")
    #expect(index.host(of: .session, "s2") == "box")
    #expect(index.host(of: .agent, "a2") == "box")
    #expect(index.host(of: .project, "/p") == "box")

    index.learn(response: json(#"{"id":"t1","title":"zsh"}"#), method: "create_terminal", host: "box")
    #expect(index.host(of: .terminal, "t1") == "box")
    #expect(index.subscriptionHost("terminal:t1") == "box")

    let event = try! JSONDecoder().decode(
      EventEnvelope.self,
      from: Data(#"{"seq":1,"event":"ipc","payload":{"channel":"agent:status:a7","args":[{}]}}"#.utf8))
    index.learn(event: event, host: "mini")
    #expect(index.subscriptionHost("a7") == "mini")
  }

  @Test func forgettingAHostDropsOnlyItsIds() {
    let index = HostIndex()
    index.remember(.session, "s1", host: "mini")
    index.remember(.session, "s2", host: Hosts.local)
    index.forget(host: "mini")
    #expect(index.host(of: .session, "s1") == nil)
    #expect(index.host(of: .session, "s2") == Hosts.local)
  }
}

struct HostCommandTargetTests {
  @Test func mirrorsTheDesktopsRouting() {
    #expect(HostCommandTarget.of("open_external_url", tier: "host") == .client)
    #expect(HostCommandTarget.of("show_open_dialog") == .client)
    #expect(HostCommandTarget.of("remote_start_pairing", tier: "host") == .client)
    #expect(HostCommandTarget.of("telemetry_capture") == .client)
    #expect(HostCommandTarget.of("ui.focus") == .client)
    #expect(HostCommandTarget.of("reveal_in_finder", tier: "host") == .unavailable)
    #expect(HostCommandTarget.of("open_in_editor") == .unavailable)
    #expect(HostCommandTarget.of("huddle_start", tier: "host") == .unavailable)
    #expect(HostCommandTarget.of("start_agent", tier: "admin") == .host)
    #expect(HostCommandTarget.of("agents.list") == .host)
  }
}

struct HostRouterTests {
  private func router() -> HostRouter {
    HostRouter(local: LocalBackend(socketPath: "/nonexistent/host.sock"))
  }

  @Test func routesBySubjectThenFocusThenThisMac() {
    let router = router()
    router.index.remember(.session, "remote-session", host: "mini")
    #expect(router.destination("get_session", json(#"{"id":"remote-session"}"#), tier: "admin") == .remote("mini"))
    #expect(router.destination("get_app_settings", json("{}"), tier: "admin") == .local)
    router.focusedHost = "mini"
    #expect(router.destination("get_app_settings", json("{}"), tier: "admin") == .remote("mini"))
    // This Mac's own trust store and windows never leave it.
    #expect(router.destination("remote_start_pairing", json("{}"), tier: "host") == .local)
    #expect(
      router.destination("open_external_url", json(#"{"sessionId":"remote-session"}"#), tier: "host")
        == .local)
  }

  @Test func listsSpanEveryHostUnlessNarrowed() {
    let router = router()
    router.index.remember(.project, "/remote", host: "mini")
    #expect(router.destination("projects.list", json("{}"), tier: nil) == .merged)
    #expect(router.destination("agents.list", json("{}"), tier: nil) == .merged)
    #expect(router.destination("agents.list", json(#"{"repo_root":"/remote"}"#), tier: nil) == .remote("mini"))
  }

  @Test func aPinWinsOverEverything() async {
    let router = router()
    router.index.remember(.session, "s", host: "mini")
    let pinned = HostRouter.$pinned.withValue("box") {
      router.destination("list_simulators", json(#"{"sessionId":"s"}"#), tier: "admin")
    }
    #expect(pinned == .remote("box"))
  }

  @Test func mergeConcatenatesListsKeyByKey() {
    let a = json(#"{"sessions":[1],"agents":[],"extra":"a"}"#)
    let b = json(#"{"sessions":[2],"agents":[3],"extra":"b","more":[4]}"#)
    #expect(HostRouter.merge(a, b) == json(#"{"sessions":[1,2],"agents":[3],"extra":"a","more":[4]}"#))
    #expect(HostRouter.merge(json("[1]"), json("[2,3]")) == json("[1,2,3]"))
  }
}

struct PairedHostsFileTests {
  @Test func roundTripsAndIsPrivate() throws {
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("argus-hosts-\(UUID().uuidString)/hosts.json")
    let file = PairedHostsFile(url: url)
    #expect(file.load() == .init())
    let identity = DeviceIdentity(
      deviceId: "d1", devPrivB64: "p", devPubB64: "q", desktopPubB64: "r", url: "ws://x:1",
      capabilities: ["admin"])
    try file.save(.init(hosts: [identity], attached: ["d1"]))
    #expect(file.load().hosts.map(\.deviceId) == ["d1"])
    #expect(file.load().attached == ["d1"])
    let mode = try FileManager.default.attributesOfItem(atPath: url.path)[.posixPermissions] as? Int
    #expect(mode == 0o600)
    try FileManager.default.removeItem(at: url.deletingLastPathComponent())
  }
}
