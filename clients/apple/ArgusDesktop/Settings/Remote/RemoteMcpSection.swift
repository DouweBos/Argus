import AppKit
import ArgusCore
import ArgusUI
import SwiftUI

/// What an outside MCP client may do, in the words Settings uses.
extension ArgusProtocol.McpAccess {
  static let levels: [Self] = [.monitor, .control, .admin]

  var label: String {
    switch self {
    case .monitor: "Read only"
    case .control: "Supervised"
    case .admin: "Full access"
    default: rawValue
    }
  }

  var help: String {
    switch self {
    case .monitor: "Look at projects, sessions, agents, diffs and terminals."
    case .control: "Also start and message agents. They ask before every tool use, here."
    case .admin: "Also merge, delete sessions, write files and pick any permission mode."
    default: ""
    }
  }
}

/// Remote Access → MCP clients: serve Argus's MCP server to outside agents over
/// OAuth, answer their sign-ins and revoke them. Plain data in, actions out,
/// so the gallery renders it from fixtures.
struct RemoteMcpSection: View {
  @Environment(\.theme) private var theme
  let status: ArgusProtocol.RemoteStatus?
  let busy: Bool
  let setEnabled: (Bool) -> Void
  let decide: (ArgusProtocol.McpAccessRequest, ArgusProtocol.McpAccess?) -> Void
  let setAccess: (ArgusProtocol.McpClientGrant, ArgusProtocol.McpAccess) -> Void
  let revoke: (ArgusProtocol.McpClientGrant) -> Void

  private var remoteOn: Bool { status?.enabled ?? false }
  private var on: Bool { status?.mcpClients ?? false }

  var body: some View {
    SettingsGroup(
      "MCP clients",
      footer:
        "Lets agents outside Argus — Claude Code or Codex in a terminal, cloud assistants, bots — sign in over OAuth and use Argus's tools. Each sign-in waits for you here, and you choose what it may do. Only served over the tunnel, your tailnet and this Mac itself, never in the clear on your network."
    ) {
      SettingsToggleRow(
        "Let MCP clients sign in",
        isOn: Binding(get: { on }, set: setEnabled)
      )
      .disabled(busy || !remoteOn)
      if on {
        if let url = status?.mcpUrls?.first {
          SettingsRow("Add it to Claude Code", stacked: true) {
            CopyableCommand(text: "claude mcp add --transport http argus \(url)")
          }
        }
        ForEach(status?.mcpRequests ?? [], id: \.requestId) { request in
          McpRequestRow(request: request, busy: busy, decide: decide)
        }
        ForEach(status?.mcpGrants ?? [], id: \.grantId) { grant in
          McpGrantRow(grant: grant, busy: busy, setAccess: setAccess, revoke: revoke)
        }
      }
    }
  }
}

/// A command with a copy button.
private struct CopyableCommand: View {
  @Environment(\.theme) private var theme
  let text: String

  var body: some View {
    HStack(spacing: 8) {
      Text(text)
        .font(.system(.callout, design: .monospaced))
        .textSelection(.enabled)
        .lineLimit(2)
      Spacer(minLength: 0)
      Button {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
      } label: {
        Image(systemName: "doc.on.doc")
      }
      .buttonStyle(.argusBorderless)
      .help("Copy")
    }
  }
}

/// A sign-in waiting on the user: who, its match code, where it returns, and
/// the access to approve it with.
private struct McpRequestRow: View {
  @Environment(\.theme) private var theme
  let request: ArgusProtocol.McpAccessRequest
  let busy: Bool
  let decide: (ArgusProtocol.McpAccessRequest, ArgusProtocol.McpAccess?) -> Void
  @State private var access: ArgusProtocol.McpAccess

  init(
    request: ArgusProtocol.McpAccessRequest, busy: Bool,
    decide: @escaping (ArgusProtocol.McpAccessRequest, ArgusProtocol.McpAccess?) -> Void
  ) {
    self.request = request
    self.busy = busy
    self.decide = decide
    _access = State(initialValue: request.requestedAccess ?? .control)
  }

  var body: some View {
    HStack(spacing: 10) {
      SettingsRowIcon("person.badge.key")
      VStack(alignment: .leading, spacing: 2) {
        Text("\(request.clientName) wants access").fontWeight(.medium)
        HStack(spacing: 6) {
          Text("code \(request.matchCode)").font(.system(.caption, design: .monospaced))
          Text("·")
          Text("returns to \(request.redirectHost)")
        }
        .font(.scaled(.caption))
        .foregroundStyle(theme.textSecondary)
      }
      Spacer()
      Picker("Access", selection: $access) {
        ForEach(ArgusProtocol.McpAccess.levels, id: \.self) { a in
          Text(a.label).tag(a)
        }
      }
      .labelsHidden()
      .fixedSize()
      .help(access.help)
      .clickable()
      Button("Deny") { decide(request, nil) }
        .disabled(busy)
      Button("Approve") { decide(request, access) }
        .buttonStyle(.borderedProminent)
        .disabled(busy)
    }
  }
}

/// A signed-in client: its access, when it was last used, and Revoke.
private struct McpGrantRow: View {
  @Environment(\.theme) private var theme
  let grant: ArgusProtocol.McpClientGrant
  let busy: Bool
  let setAccess: (ArgusProtocol.McpClientGrant, ArgusProtocol.McpAccess) -> Void
  let revoke: (ArgusProtocol.McpClientGrant) -> Void

  var body: some View {
    HStack(spacing: 10) {
      SettingsRowIcon("terminal")
      VStack(alignment: .leading, spacing: 2) {
        Text(grant.clientName).fontWeight(.medium)
        HStack(spacing: 6) {
          if grant.connected {
            StatusDot(tone: .success, pulse: true)
            Text("connected")
          } else {
            Text(grant.lastUsedAt == nil ? "not used yet" : "used \(RemoteAccessLabels.lastSeen(grant.lastUsedAt))")
          }
        }
        .font(.scaled(.caption))
        .foregroundStyle(theme.textSecondary)
      }
      Spacer()
      Menu(grant.access.label) {
        ForEach(ArgusProtocol.McpAccess.levels, id: \.self) { a in
          Button(a.label) { setAccess(grant, a) }
            .help(a.help)
        }
      }
      .menuStyle(.borderlessButton)
      .fixedSize()
      .disabled(busy)
      .clickable()
      // No destructive role: inside a grouped row it stops taking clicks.
      Button("Revoke") { revoke(grant) }
        .foregroundStyle(theme.error)
        .disabled(busy)
    }
  }
}
