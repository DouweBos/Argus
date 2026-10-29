import ArgusKit
import Foundation
import Testing

@testable import ArgusCore

@Suite("Agent MCP servers")
struct AgentMcpServersTests {
  private func servers(_ list: [ArgusProtocol.RemoteMcpServerStatus]?) -> AgentMcpServers {
    AgentMcpServers(.init(servers: list, accountId: "acc-1"))
  }

  @Test("failures and sign-ins come first, disabled last, by name within a state")
  func order() {
    let result = servers([
      .init(name: "zeta", status: "connected"),
      .init(name: "off", status: "disabled"),
      .init(name: "alpha", status: "connected"),
      .init(name: "claude.ai Slack", status: "needs-auth", source: "claudeai"),
      .init(name: "posthog", status: "failed", error: "boom"),
    ])
    #expect(result.servers?.map(\.name) == ["posthog", "claude.ai Slack", "alpha", "zeta", "off"])
    #expect(result.connectedCount == 2)
    #expect(result.problemCount == 2)
    #expect(result.accountId == "acc-1")
  }

  @Test("a plugin's server reads by its own name, with the plugin as its origin")
  func pluginNames() {
    let server = servers([.init(name: "plugin:team-tools:linear", status: "connected", source: "plugin")])
      .servers?.first
    #expect(server?.displayName == "linear")
    #expect(server?.origin == "team-tools plugin")
  }

  @Test("an unknown status survives, and a runner that can't report gives nil")
  func unknown() {
    #expect(servers([.init(name: "x", status: "starting")]).servers?.first?.state == .other("starting"))
    #expect(servers(nil).servers == nil)
    #expect(servers(nil).problemCount == 0)
  }
}
