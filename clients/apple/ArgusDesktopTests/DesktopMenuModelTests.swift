import ArgusCore
import ArgusMenuBar
import Foundation
import Testing

@testable import Argus

struct DesktopMenuModelTests {
  static func agent(_ id: String, status: String, session: String = "s1") -> RemoteAgentStatus {
    let json = """
      {"agent_id":"\(id)","session_id":"\(session)","session_label":"fix-login","title":"Agent \(id)","status":"\(status)"}
      """
    return try! JSONDecoder().decode(RemoteAgentStatus.self, from: Data(json.utf8))
  }

  static func menu(
    host: HostSupervisor.State = .running, attached: Bool = false, agents: [RemoteAgentStatus] = [],
    canPair: Bool = true, account: AccountMenuSnapshot? = nil, canCheckForUpdates: Bool? = true
  ) -> DesktopMenuSnapshot {
    .init(
      host: host, attached: attached, agents: agents, canPair: canPair, pairing: .idle, account: account,
      canCheckForUpdates: canCheckForUpdates, loginItem: .off)
  }

  static func labels(_ items: [HostMenuItem]) -> [String] { items.map { $0.label ?? "---" } }

  @Test func aRunningHostShowsAgentsPairingAndTheApp() {
    let items = DesktopMenuModel.items(Self.menu(agents: [Self.agent("a1", status: "requires_action")]))
    #expect(Self.labels(items) == [
      "Open Argus", "---", "Host: running", "---", "Needs you (1)", "Agent a1 — fix-login", "---",
      "Pair a device…", "---", "Check for Updates…", "Open at Login", "Settings…", "Quit Argus",
    ])
    #expect(items.contains(.action("Agent a1 — fix-login", .openAgent("a1"))))
  }

  @Test func pairingWithRemoteAccessOffGoesToSettings() {
    let items = DesktopMenuModel.pairingItems(Self.menu(canPair: false))
    #expect(items == [.action("Pair a device…", .openRemoteSettings)])
    #expect(DesktopMenuModel.pairingItems(Self.menu()) == [.action("Pair a device…", .pair)])
  }

  @Test func anAttachedWindowLeavesPairingAndTheAccountToTheHostsApp() {
    let holder = HostLockRecord(pid: 1, ownerPid: 2, owner: .macServer, startedAt: 0)
    let labels = Self.labels(DesktopMenuModel.items(Self.menu(host: .attached(holder), attached: true)))
    #expect(!labels.contains("Pair a device…"))
    #expect(labels.contains("No agents running"))
  }

  @Test func aHostThatIsDownKeepsOnlyTheApp() {
    let labels = Self.labels(DesktopMenuModel.items(Self.menu(host: .failed("boom"), canCheckForUpdates: nil)))
    #expect(labels == [
      "Open Argus", "---", "Host: failed", "boom", "Restart Host", "---", "Open at Login", "Settings…", "Quit Argus",
    ])
  }

  @Test func onlyLinkingAndJoinsAreCountedFromTheAccountSection() {
    #expect(MacTelemetryEvent.MenuBarAction(.approve(requestId: "r1")) == .approveJoin)
    #expect(MacTelemetryEvent.MenuBarAction(.linkCopyCode("ABCD")) == nil)
  }
}
