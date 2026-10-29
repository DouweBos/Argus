import ArgusCore
import ArgusUI
import SwiftUI

/// The context card's MCP row: how many of the agent's servers connected, and
/// a popover listing each one — with several Claude accounts, every agent can
/// reach a different set.
struct McpContextRow: View {
  @Environment(HostStore.self) private var store
  @Environment(\.theme) private var theme
  let agentId: String
  @State private var open = false

  private var servers: AgentMcpServers? { store.mcpServersByAgent[agentId] }

  var body: some View {
    Button {
      open = true
      MacTelemetry.capture(.contextCardUsed(action: .mcp))
    } label: {
      ContextCardRow(icon: Icon.mcp, title: "MCP", muted: servers?.servers?.isEmpty ?? true) {
        if let servers, let list = servers.servers, !list.isEmpty {
          HStack(spacing: 5) {
            if servers.problemCount > 0 { StatusDot(tone: .warning) }
            Text("\(servers.connectedCount)/\(list.count)")
              .font(.scaled(size: 11).monospacedDigit())
              .foregroundStyle(theme.textSecondary)
          }
        }
      }
    }
    .buttonStyle(ContextRowButtonStyle(selected: open))
    .help(help)
    .task(id: agentId) { await store.loadMcpServers(agentId: agentId) }
    .popover(isPresented: $open, arrowEdge: .leading) {
      AgentMcpServersView(agentId: agentId)
        .frame(width: 320)
        .frame(maxHeight: 420)
    }
  }

  private var help: String {
    guard let servers, let list = servers.servers else { return "This agent's MCP servers" }
    if servers.problemCount > 0 {
      return "\(servers.problemCount) of \(list.count) MCP servers need attention"
    }
    return "\(servers.connectedCount) of \(list.count) MCP servers connected"
  }
}
