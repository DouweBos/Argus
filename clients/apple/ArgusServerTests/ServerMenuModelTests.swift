import ArgusCore
import ArgusUpdate
import Foundation
import Testing

@testable import Argus_Server

struct ServerMenuModelTests {
  typealias F = Fixtures

  @Test func runningServerShowsEverySection() {
    let labels = F.labels(ServerMenuModel.items(F.menu()))
    #expect(Array(labels.prefix(4)) == ["Argus Server 1.2.3", "Host: running", "Gateway: ws://127.0.0.1:47617", "State: ~/.argus-server"])
    #expect(labels.contains("No agents running"))
    #expect(labels.contains("Pair a device…"))
    #expect(labels.contains("Check for Updates…"))
    #expect(labels.contains("Open Web Client"))
    #expect(labels.suffix(3) == ["Open at Login", "Settings…", "Quit Argus Server"])
  }

  @Test func aHostThatIsNotUpHidesWhatNeedsIt() {
    let holder = HostLockRecord(pid: 1, ownerPid: 2, owner: .electron, startedAt: 0)
    let items = ServerMenuModel.items(F.menu(host: .locked(holder)))
    let labels = F.labels(items)
    #expect(labels.contains("Host: Argus (Electron) is running on this Argus home"))
    #expect(F.action(F.find(items, "Take Over from the Old Argus Server")) == .takeOver)
    #expect(!labels.contains("Pair a device…"))
    #expect(labels.last == "Quit Argus Server")
  }

  @Test func failedHostOffersARestart() {
    let items = ServerMenuModel.items(F.menu(host: .failed("keeps crashing")))
    #expect(F.labels(items).contains("Host: failed"))
    #expect(F.action(F.find(items, "Restart Host")) == .restartHost)
    #expect(F.labels(ServerMenuModel.hostItems(.restarting(attempt: 2))) == ["Host: restarting (2)"])
  }

  @Test func agentsGroupByProjectAndSessionAndOpenInTheWebClient() {
    let agents = [
      F.agent("a1", createdAt: 1), F.agent("a2", status: "idle", createdAt: 2),
      F.agent("b1", session: "s2", label: "docs", project: "Site", status: "idle", createdAt: 5),
    ]
    let items = ServerMenuModel.agentItems(agents)
    #expect(F.labels(items) == ["3 agents · 1 active", "○ Site  (1)", "● Argus  (2)"])
    let session = F.find(F.children(F.find(items, "● Argus  (2)")), "● fix-login  (2)")
    #expect(F.labels(F.children(session)) == ["● Agent a1", "○ Agent a2"])
    #expect(F.action(F.find(F.children(session), "● Agent a1")) == .openAgent("a1"))
  }

  @Test func pairingWalksThroughTheSasAndOffersAdminOnlyToADesktop() {
    #expect(F.labels(ServerMenuModel.pairingItems(.waitingForDevice(qrPayload: "q", pairingCode: "c"))).contains("Cancel pairing"))
    let phone = PairingClientInfo(product: "Argus", kind: "ios")
    let phoneItems = ServerMenuModel.pairingItems(.confirming(sas: "123456", client: phone))
    #expect(F.labels(phoneItems) == [
      "Confirm this matches: 123456", "Approve — watch only", "Approve — run agents", "Reject",
    ])
    let desktopItems = ServerMenuModel.pairingItems(.confirming(sas: "123456", client: nil))
    #expect(F.action(F.find(desktopItems, "Approve — full control of this Mac")) == .confirmPairing(control: true, admin: true))
    #expect(F.labels(ServerMenuModel.pairingItems(.paired(label: "iPhone"))) == ["Paired with iPhone", "Dismiss"])
  }

  @Test func updateRowsMirrorTheElectronTray() {
    func labels(_ update: UpdateState, agents: Int = 0) -> [String] {
      F.labels(ServerMenuModel.updateItems(F.menu(agents: (0..<agents).map { F.agent("a\($0)") }, update: update)))
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
    let items = ServerMenuModel.updateItems(F.menu(autoInstall: true))
    #expect(F.find(items, "Install Automatically When Idle") == .toggle("Install Automatically When Idle", isOn: true, .toggleAutoInstall))
  }

  @Test func loginItemNeedingApprovalSaysWhere() {
    let items = ServerMenuModel.appItems(F.menu(loginItem: .requiresApproval, oldLoginAgent: true))
    #expect(F.labels(items) == [
      "Start at Login with This App…", "Open at Login", "Allow in Login Items…", "Settings…", "Quit Argus Server",
    ])
  }

  @Test func oldFormatSecretsAreCalledOut() {
    let labels = F.labels(ServerMenuModel.statusItems(F.menu(legacySecrets: ["paired devices"])))
    #expect(labels.contains("Paired devices still in the old format — open the old Argus Server once"))
  }
}
