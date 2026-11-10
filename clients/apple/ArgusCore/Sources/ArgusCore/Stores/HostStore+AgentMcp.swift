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

  /// The account an agent should run as: its session's pin, else the computer's active account.
  public func expectedClaudeAccountId(agentId: String) -> String? {
    let sessionId = agentsByRepo.values.lazy.flatMap { $0 }.first { $0.agentId == agentId }?.sessionId
    if let sessionId, let pin = claudeAccountId(forSessionId: sessionId),
      claudeAccounts?.contains(where: { $0.id == pin }) ?? true
    {
      return pin
    }
    return activeClaudeAccountId
  }

  /// What a view watching an agent's MCP servers should reload on: switching
  /// accounts respawns the agent under the same id, once its turn ends.
  public func mcpServersKey(agentId: String) -> String {
    let status = agentsByRepo.values.lazy.flatMap { $0 }.first { $0.agentId == agentId }?.status
    return "\(agentId):\(expectedClaudeAccountId(agentId: agentId) ?? "-"):\(status.map { "\($0)" } ?? "-")"
  }

  /// Load, then keep reloading while the agent hasn't reached its account yet
  /// or a server is still connecting — the respawn and the connects take a moment.
  public func followMcpServers(agentId: String, interval: Duration = .seconds(2), attempts: Int = 30) async {
    for attempt in 1...max(attempts, 1) {
      await loadMcpServers(agentId: agentId)
      guard let servers = mcpServersByAgent[agentId], mcpServersErrorByAgent[agentId] == nil else { return }
      let expected = expectedClaudeAccountId(agentId: agentId)
      let onAccount = expected == nil || servers.accountId == nil || servers.accountId == expected
      let connecting = servers.servers?.contains { $0.state == .pending } ?? false
      guard attempt < attempts, !onAccount || connecting else { return }
      try? await Task.sleep(for: interval)
      if Task.isCancelled { return }
    }
  }
}
