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
              ForEach(list) { McpServerRow(agentId: agentId, server: $0) }
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
      Loading(label: "Checking MCP servers").frame(maxWidth: .infinity).padding(16)
    }
  }

  private func reload() {
    Task { await host.loadMcpServers(agentId: agentId) }
  }
}

/// One server: its state, and what can be done about it (sign in, reconnect,
/// switch it off), as `/mcp` offers in a terminal.
private struct McpServerRow: View {
  @Environment(HostStore.self) private var host
  @Environment(\.theme) private var theme
  @Environment(\.openURL) private var openURL
  let agentId: String
  let server: AgentMcpServers.Server

  private var activity: McpServerActivity? { host.mcpServerActivity(agentId: agentId, server: server.name) }

  private var tone: Tone {
    switch server.state {
    case .connected: .success
    case .pending: .accent
    case .needsAuth: .warning
    case .failed: .danger
    case .disabled, .other: .muted
    }
  }

  /// The one action the state asks for, offered as a button.
  private var primary: McpServerAction? {
    guard host.hasControl, activity == nil else { return nil }
    switch server.state {
    case .needsAuth: return .signIn
    case .failed: return .reconnect
    case .disabled: return .enable
    default: return nil
    }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .center, spacing: 8) {
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
              .foregroundStyle(detailIsError ? theme.error : theme.textMuted)
              .lineLimit(2)
              .textSelection(.enabled)
          }
        }
        Spacer(minLength: 8)
        trailing
      }
      if case .signingIn(let url, let callbackExpected) = activity {
        signingIn(url: url, callbackExpected: callbackExpected)
      }
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 5)
    .help(server.name)
  }

  @ViewBuilder private var trailing: some View {
    if activity == .working {
      ProgressView().controlSize(.small)
    } else if let primary {
      Btn(label: primary.title, tone: .secondary, small: true) { run(primary) }.fixedSize()
    } else {
      Text(server.state.label)
        .font(.scaled(size: 11))
        .foregroundStyle(tone == .muted ? theme.textMuted : tone.color(theme))
    }
    if host.hasControl, activity != .working { menu }
  }

  private var menu: some View {
    Menu {
      if server.state != .disabled {
        Button("Reconnect", systemImage: Icon.refresh) { run(.reconnect) }
      }
      if server.state == .needsAuth || server.state == .failed {
        Button("Sign In", systemImage: Icon.person) { run(.signIn) }
      }
      Divider()
      if server.state == .disabled {
        Button("Enable", systemImage: "power") { run(.enable) }
      } else {
        Button("Disable", systemImage: "power") { run(.disable) }
      }
    } label: {
      Image(systemName: Icon.ellipsis)
        .font(.scaled(size: 12, weight: .semibold))
        .foregroundStyle(theme.textSecondary)
        .frame(width: 22, height: 22)
        .contentShape(.rect)
    }
    .borderlessMenu()
    .menuIndicator(.hidden)
    .fixedSize()
    .clickable()
    .accessibilityLabel("Actions for \(server.displayName)")
  }

  /// The sign-in page is open in the browser: open it again, or hand back the
  /// address it ended on when that browser can't reach the agent (another device).
  private func signingIn(url: URL, callbackExpected: Bool) -> some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(
        callbackExpected
          ? "Complete the sign-in in your browser. If it ends on a page that won't load, copy that page's address and paste it here."
          : "Complete the sign-in in your browser, then reconnect."
      )
      .font(.scaled(size: 11))
      .foregroundStyle(theme.textSecondary)
      .fixedSize(horizontal: false, vertical: true)
      // Wraps rather than widening the popover past its edges at larger text sizes.
      FlowRow(spacing: 6, rowSpacing: 6, packed: true) {
        if callbackExpected {
          Btn(label: "Paste Address", tone: .secondary, small: true, icon: Icon.link) { pasteAddress() }.fixedSize()
        } else {
          Btn(label: "Reconnect", tone: .secondary, small: true, icon: Icon.refresh) { run(.reconnect) }.fixedSize()
        }
        Btn(label: "Open Again", tone: .ghost, small: true) { openURL(url) }.fixedSize()
        Btn(label: "Cancel", tone: .ghost, small: true) {
          host.dismissMcpServerActivity(agentId: agentId, server: server.name)
        }
        .fixedSize()
      }
    }
    .padding(.leading, 16)
  }

  private var detailIsError: Bool {
    if case .failed = activity { return true }
    return server.state == .failed
  }

  private var detail: String? {
    if case .failed(let message) = activity { return message }
    if let error = server.error, server.state == .failed { return error }
    let tools = server.toolCount.map { $0 == 1 ? "1 tool" : "\($0) tools" }
    // With a button in its place, the state moves into the detail line.
    let state = primary == nil ? nil : server.state.label
    let parts = [state, server.origin, tools].compactMap { $0 }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
  }

  private func run(_ action: McpServerAction) {
    Task {
      if let url = await host.actOnMcpServer(agentId: agentId, server: server.name, action: action) {
        openURL(url)
      }
    }
  }

  private func pasteAddress() {
    guard let address = Clipboard.string()?.trimmingCharacters(in: .whitespacesAndNewlines), !address.isEmpty
    else { return }
    Task {
      await host.actOnMcpServer(agentId: agentId, server: server.name, action: .finishSignIn, callbackUrl: address)
    }
  }
}

extension McpServerAction {
  var title: String {
    switch self {
    case .signIn: "Sign In"
    case .reconnect: "Reconnect"
    case .enable: "Enable"
    case .disable: "Disable"
    default: rawValue.capitalized
    }
  }
}

extension View {
  /// A bare glyph that opens a menu: no bezel on the Mac, no tint on the phone.
  fileprivate func borderlessMenu() -> some View {
    #if os(macOS)
      menuStyle(.borderlessButton)
    #else
      menuStyle(.button).buttonStyle(.argusPlain)
    #endif
  }
}
