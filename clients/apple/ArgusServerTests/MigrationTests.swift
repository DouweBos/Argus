import Foundation
import Testing

@testable import Argus_Server

struct MigrationTests {
  @Test func asksOnceThenLeavesItToTheMenu() {
    #expect(MigrationPlan.decide(oldAgentInstalled: true, alreadyAsked: false, isDebug: false) == .offerLoginItem)
    #expect(MigrationPlan.decide(oldAgentInstalled: true, alreadyAsked: true, isDebug: false) == .menuOnly)
    #expect(MigrationPlan.decide(oldAgentInstalled: false, alreadyAsked: false, isDebug: false) == .none)
    // A debug build never touches the real login setup.
    #expect(MigrationPlan.decide(oldAgentInstalled: true, alreadyAsked: false, isDebug: true) == .none)
  }

  @Test func movesTheOldPlistIntoTheHome() throws {
    let root = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("argus-migrate-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: root) }
    let agents = root.appendingPathComponent("LaunchAgents")
    let home = root.appendingPathComponent("home")
    try FileManager.default.createDirectory(at: agents, withIntermediateDirectories: true)
    let agent = LegacyServerAgent(launchAgents: agents, home: home)
    #expect(!agent.isInstalled)
    try Data("old".utf8).write(to: agent.plist)
    #expect(agent.isInstalled)

    try agent.moveAside()
    #expect(!agent.isInstalled)
    #expect(try String(contentsOf: agent.movedPlist, encoding: .utf8) == "old")
    // A second migration replaces the copy kept earlier.
    try Data("newer".utf8).write(to: agent.plist)
    try agent.moveAside()
    #expect(try String(contentsOf: agent.movedPlist, encoding: .utf8) == "newer")
  }

  @Test func knowsWhenItIsTheOldAgentsJob() {
    #expect(LegacyServerAgent.isRunningUnder(environment: ["XPC_SERVICE_NAME": "dev.houwert.argus.server"]))
    #expect(!LegacyServerAgent.isRunningUnder(environment: ["XPC_SERVICE_NAME": "dev.houwert.argus.server.agent"]))
    #expect(LegacyServerAgent.bootoutCommand(uid: 501) == ["/bin/launchctl", "bootout", "gui/501/dev.houwert.argus.server"])
  }

  @MainActor
  @Test func loginItemLabelFollowsTheBundle() {
    let item = LoginItem(bundleId: "dev.houwert.argus.server.dev")
    #expect(item.label == "dev.houwert.argus.server.dev.agent")
    #expect(item.launchedByLaunchd(environment: ["XPC_SERVICE_NAME": "dev.houwert.argus.server.dev.agent"]))
    #expect(!item.launchedByLaunchd(environment: [:]))
  }
}
