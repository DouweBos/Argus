import ArgusCore
import ArgusUpdate
import Foundation
import Testing

@testable import ArgusMenuBar

struct HostMenuModelTests {
  typealias F = Fixtures

  @Test func hostStatesReadAsOneLine() {
    #expect(F.labels(HostMenuModel.hostItems(.running)) == ["Host: running"])
    #expect(F.labels(HostMenuModel.hostItems(.restarting(attempt: 2))) == ["Host: restarting (2)"])
    let failed = HostMenuModel.hostItems(.failed("keeps crashing"))
    #expect(F.labels(failed) == ["Host: failed", "keeps crashing", "Restart Host"])
    #expect(F.action(F.find(failed, "Restart Host")) == .restartHost)
    let holder = HostLockRecord(pid: 1, ownerPid: 2, owner: .electron, startedAt: 0)
    #expect(F.labels(HostMenuModel.hostItems(.locked(holder))) == ["Host: Argus (Electron) is running on this Argus home"])
    #expect(HostMenuModel.isUp(.attached(holder)))
    #expect(!HostMenuModel.isUp(.locked(holder)))
  }

  @Test func agentsGroupByProjectAndSession() {
    let agents = [
      F.agent("a1", createdAt: 1), F.agent("a2", status: "idle", createdAt: 2),
      F.agent("b1", session: "s2", label: "docs", project: "Site", status: "idle", createdAt: 5),
    ]
    let items = HostMenuModel.agentTree(agents)
    #expect(F.labels(items) == ["3 agents · 1 active", "○ Site  (1)", "● Argus  (2)"])
    let session = F.find(F.children(F.find(items, "● Argus  (2)")), "● fix-login  (2)")
    #expect(F.labels(F.children(session)) == ["● Agent a1", "○ Agent a2"])
    #expect(F.action(F.find(F.children(session), "● Agent a1")) == .openAgent("a1"))
  }

  @Test func activeAgentsPutWhoNeedsYouFirst() {
    let agents = [
      F.agent("a1", createdAt: 1), F.agent("a2", label: "docs", status: "requires_action", createdAt: 2),
      F.agent("a3", status: "idle"), F.agent("a4", createdAt: 3),
    ]
    let items = HostMenuModel.activeAgents(agents)
    #expect(F.labels(items) == [
      "Needs you (1)", "Agent a2 — docs", "Running (2)", "Agent a4 — fix-login", "Agent a1 — fix-login",
    ])
    #expect(F.action(F.find(items, "Agent a2 — docs")) == .openAgent("a2"))
    #expect(F.labels(HostMenuModel.activeAgents([F.agent("a3", status: "idle")])) == ["No agents running"])
    let many = (0..<12).map { F.agent("a\($0)") }
    #expect(HostMenuModel.activeAgents(many, limit: 3).count == 4)
  }

  @Test func pairingWalksThroughTheSasAndOffersAdminOnlyToADesktop() {
    #expect(F.labels(HostMenuModel.pairingItems(.waitingForDevice(qrPayload: "q", pairingCode: "c"))).contains("Cancel pairing"))
    let phone = PairingClientInfo(product: "Argus", kind: "ios")
    let phoneItems = HostMenuModel.pairingItems(.confirming(sas: "123456", client: phone))
    #expect(F.labels(phoneItems) == [
      "Confirm this matches: 123456", "Approve — watch only", "Approve — run agents", "Reject",
    ])
    let desktopItems = HostMenuModel.pairingItems(.confirming(sas: "123456", client: nil))
    #expect(F.action(F.find(desktopItems, "Approve — full control of this Mac")) == .confirmPairing(control: true, admin: true))
    #expect(F.labels(HostMenuModel.pairingItems(.paired(label: "iPhone"))) == ["Paired with iPhone", "Dismiss"])
  }

  @Test func updateRowsMirrorTheElectronTray() {
    func labels(_ update: UpdateState, agents: Int = 0) -> [String] {
      F.labels(HostMenuModel.updateItems(update, autoInstall: false, activeAgents: agents))
    }
    #expect(labels(.idle) == ["Check for Updates…", "Install Automatically When Idle"])
    #expect(labels(.available(version: "2.0.0")).prefix(2) == ["Update available: 2.0.0", "Download Update"])
    #expect(labels(.downloading(percent: 42)).first == "Downloading update — 42%")
    #expect(labels(.ready(version: "2.0.0")).prefix(2) == ["Update ready: 2.0.0", "Restart and Install"])
    #expect(labels(.ready(version: "2.0.0"), agents: 3)[1] == "3 agents running — cannot restart")
    #expect(labels(.ready(version: "2.0.0"), agents: 1)[1] == "1 agent running — cannot restart")
    #expect(labels(.failed("offline")).prefix(2) == ["Update failed: offline", "Check for Updates…"])
    #expect(labels(.unavailable) == ["Updates aren't set up in this build"])
  }

  @Test func installWhenIdleIsAToggle() {
    let items = HostMenuModel.updateItems(.idle, autoInstall: true, activeAgents: 0)
    #expect(F.find(items, "Install Automatically When Idle") == .toggle("Install Automatically When Idle", isOn: true, .toggleAutoInstall))
  }

  @Test func loginItemNeedingApprovalSaysWhere() {
    #expect(F.labels(HostMenuModel.loginItems(.requiresApproval)) == ["Open at Login", "Allow in Login Items…"])
    #expect(HostMenuModel.loginItems(.unavailable) == [.toggle("Open at Login", isOn: false, .toggleOpenAtLogin)])
  }

  @MainActor @Test func theMacAppsLoginItemIsNotAnAgent() {
    #expect(!LoginItem.mainApp.launchedByLaunchd(environment: ["XPC_SERVICE_NAME": "dev.houwert.argus.mac.agent"]))
    let server = LoginItem(bundleId: "dev.houwert.argus.server")
    #expect(server.launchedByLaunchd(environment: ["XPC_SERVICE_NAME": "dev.houwert.argus.server.agent"]))
  }
}
