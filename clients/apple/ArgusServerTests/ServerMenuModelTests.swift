import ArgusCore
import ArgusMenuBar
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

  @Test func updatesCountRunningAgentsBeforeRestarting() {
    let items = ServerMenuModel.updateItems(F.menu(agents: [F.agent("a1")], update: .ready(version: "2.0.0")))
    #expect(F.labels(items) == ["Update ready: 2.0.0", "1 agent running — cannot restart", "Install Automatically When Idle"])
  }

  @Test func attachedToTheMacAppOffersToRunHere() {
    let holder = HostLockRecord(pid: 1, ownerPid: 2, owner: .mac, startedAt: 0)
    let items = ServerMenuModel.hostItems(.attached(holder))
    #expect(F.action(F.find(items, "Quit \(holder.appName) and Run Here")) == .takeOver)
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
