import ArgusKit
import Foundation

/// Which MCP servers an agent reached, live from its CLI — with several Claude
/// accounts, each agent can see a different set of connectors.
extension HostStore {
  public func loadMcpServers(agentId: String) async {
    guard let backend else { return }
    do {
      let result = try await backend.request(
        .agentsMcpStatus, ArgusProtocol.MethodsTypes.AgentsMcpStatusParams(agentId: agentId),
        as: ArgusProtocol.MethodsTypes.AgentsMcpStatusResult.self)
      mcpServersByAgent[agentId] = AgentMcpServers(result)
      mcpServersErrorByAgent[agentId] = nil
    } catch {
      // A poll that lost its connection keeps what it had and retries on reconnect.
      guard !Self.isQuiet(error) else { return }
      mcpServersErrorByAgent[agentId] = Self.describe(error)
      hooks.errorReported(error, "mcp_status")
    }
  }
}
