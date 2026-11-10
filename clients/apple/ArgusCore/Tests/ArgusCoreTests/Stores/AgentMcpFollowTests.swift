@testable import ArgusCore
import Foundation
import Testing

@MainActor
struct AgentMcpFollowTests {
  @Test func keepsReloadingUntilTheAgentRunsOnItsNewAccountAndItsServersConnect() async {
    let backend = RecordingBackend()
    var replies = [
      #"{"servers":[{"name":"linear","status":"connected"}],"account_id":"old"}"#,
      #"{"servers":[{"name":"github","status":"pending"}],"account_id":"new"}"#,
      #"{"servers":[{"name":"github","status":"connected"}],"account_id":"new"}"#,
      #"{"servers":[{"name":"github","status":"failed"}],"account_id":"new"}"#,
    ]
    backend.reply("agents.mcp_status") { replies.isEmpty ? "{}" : replies.removeFirst() }
    let host = HostStore()
    await host.attach(backend)
    host.activeClaudeAccountId = "new"

    await host.followMcpServers(agentId: "a1", interval: .milliseconds(1))

    #expect(backend.calls("agents.mcp_status").count == 3)
    #expect(host.mcpServersByAgent["a1"]?.accountId == "new")
    #expect(host.mcpServersByAgent["a1"]?.connectedCount == 1)
  }

  @Test func reloadsWhenTheExpectedAccountChanges() {
    let host = HostStore()
    host.activeClaudeAccountId = "old"
    let before = host.mcpServersKey(agentId: "a1")
    host.activeClaudeAccountId = "new"
    #expect(host.mcpServersKey(agentId: "a1") != before)
  }
}
