import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

struct RunnerSetupFlowTests {
  private let setup = RemoteRunner.Setup(installCommand: "npm install -g x", loginCommand: "x login")

  @Test func startsOnInstallUntilTheCliIsFound() {
    var flow = RunnerSetupFlow(runnerId: "x", displayName: "X", setup: setup, installed: false)
    #expect(flow.step == .install)
    #expect(flow.command == "npm install -g x")
    #expect(flow.next == .wait)

    flow.phase = .finished(terminalId: "t", exitCode: 1)
    #expect(flow.next == .retry)
    flow.phase = .finished(terminalId: "t", exitCode: 0)
    #expect(flow.next == .checkAgain)
    flow.installed = true
    #expect(flow.next == .signIn)

    flow.step = .login
    flow.phase = .finished(terminalId: "t2", exitCode: 130)
    #expect(flow.next == .done)
  }

  @Test func anInstalledRunnerGoesStraightToSignIn() {
    let flow = RunnerSetupFlow(runnerId: "x", displayName: "X", setup: setup, installed: true)
    #expect(flow.step == .login)
    #expect(flow.command == "x login")
  }

  @Test func aPageOnlyInstallWaitsToBeCheckedAgain() {
    var flow = RunnerSetupFlow(
      runnerId: "agy", displayName: "Antigravity", setup: .init(installUrl: "https://example.com"), installed: false)
    flow.phase = .openedPage(url: "https://example.com")
    #expect(flow.next == .checkAgain)
    flow.installed = true
    #expect(flow.next == .done)
  }

  @Test func noFlowForARunnerArgusCantSetUp() throws {
    let json = #"{"id":"c","display_name":"C","is_custom":true,"models":[],"available":false}"#
    let runner = try JSONDecoder().decode(RemoteRunner.self, from: Data(json.utf8))
    #expect(RunnerSetupFlow(runner) == nil)
  }
}
