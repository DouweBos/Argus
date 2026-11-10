import ArgusCore
import SwiftUI

/// The MCP servers the agent's CLI loaded and whether each connected, fetched
/// when shown. Names the account the agent runs as, since connectors and
/// sign-ins belong to an account rather than to the computer.
public struct AgentMcpServersView: View {
  @Environment(HostStore.self) private var host
  @Environment(\.theme) private var theme
  let agentId: String

  public init(agentId: String) {
    self.agentId = agentId
  }

  private var servers: AgentMcpServers? { host.mcpServersByAgent[agentId] }
  private var error: String? { host.mcpServersErrorByAgent[agentId] }

  private var accountName: String? {
    guard let id = servers?.accountId, (host.claudeAccounts?.count ?? 0) > 1 else { return nil }
    return host.claudeAccounts?.first { $0.id == id }?.displayName
  }

  public var body: some View {
    content
      .task(id: host.mcpServersKey(agentId: agentId)) {
        if host.claudeAccounts == nil { await host.refreshClaudeAccounts() }
        await host.followMcpServers(agentId: agentId)
      }
  }

  @ViewBuilder private var content: some View {
    if let list = servers?.servers {
      VStack(alignment: .leading, spacing: 0) {
        if let accountName {
          Label("Running as \(accountName)", systemImage: Icon.person)
            .font(.scaled(size: 12))
            .foregroundStyle(theme.textSecondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
          Divider().overlay(theme.borderSubtle)
        }
        if list.isEmpty {
          MutedText("This agent has no MCP servers").padding(12)
        } else {
          ScrollView {
            VStack(alignment: .leading, spacing: 0) {
              ForEach(list) { McpServerRow(server: $0) }
            }
            .padding(.vertical, 4)
          }
          .scrollBounceBehavior(.basedOnSize)
        }
        if let error {
          Banner(text: error, tone: .danger, actionLabel: "Retry", action: reload).padding(8)
        }
      }
    } else if servers != nil {
      EmptyState(icon: Icon.mcp, title: "Not available", body: "This agent's CLI can't report its MCP servers.")
    } else if let error {
      EmptyState(icon: Icon.warning, title: "Couldn't load MCP servers", body: error, selectable: true) {
        Btn(label: "Retry", tone: .secondary, small: true, icon: Icon.refresh, action: reload).fixedSize()
      }
    } else {
      Loading(label: "Checking MCP servers…").frame(maxWidth: .infinity).padding(16)
    }
  }

  private func reload() {
    Task { await host.loadMcpServers(agentId: agentId) }
  }
}

private struct McpServerRow: View {
  @Environment(\.theme) private var theme
  let server: AgentMcpServers.Server

  private var tone: Tone {
    switch server.state {
    case .connected: .success
    case .pending: .accent
    case .needsAuth: .warning
    case .failed: .danger
    case .disabled, .other: .muted
    }
  }

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 8) {
      StatusDot(tone: tone, pulse: server.state == .pending)
      VStack(alignment: .leading, spacing: 2) {
        Text(server.displayName)
          .font(.scaled(size: 13))
          .foregroundStyle(server.state == .disabled ? theme.textSecondary : theme.text)
          .lineLimit(1)
          .truncationMode(.middle)
        if let detail {
          Text(detail)
            .font(.scaled(size: 11))
            .foregroundStyle(server.state == .failed ? theme.error : theme.textMuted)
            .lineLimit(2)
            .textSelection(.enabled)
        }
      }
      Spacer(minLength: 8)
      Text(server.state.label)
        .font(.scaled(size: 11))
        .foregroundStyle(tone == .muted ? theme.textMuted : tone.color(theme))
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 5)
    .help(server.name)
  }

  private var detail: String? {
    if let error = server.error, server.state == .failed { return error }
    let tools = server.toolCount.map { $0 == 1 ? "1 tool" : "\($0) tools" }
    let parts = [server.origin, tools].compactMap { $0 }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
  }
}
