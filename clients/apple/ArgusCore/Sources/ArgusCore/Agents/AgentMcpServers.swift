import ArgusKit
import Foundation

/// An agent's MCP servers as its CLI sees them, the ones that need attention first.
public struct AgentMcpServers: Sendable, Equatable {
  public enum State: Sendable, Equatable {
    case connected, pending, needsAuth, failed, disabled, other(String)

    init(_ raw: String) {
      switch raw {
      case "connected": self = .connected
      case "pending": self = .pending
      case "needs-auth": self = .needsAuth
      case "failed": self = .failed
      case "disabled": self = .disabled
      default: self = .other(raw)
      }
    }

    public var label: String {
      switch self {
      case .connected: "Connected"
      case .pending: "Connecting"
      case .needsAuth: "Needs sign-in"
      case .failed: "Failed"
      case .disabled: "Disabled"
      case .other(let raw): raw.capitalized
      }
    }

    var rank: Int {
      switch self {
      case .failed: 0
      case .needsAuth: 1
      case .other: 2
      case .pending: 3
      case .connected: 4
      case .disabled: 5
      }
    }
  }

  public struct Server: Sendable, Equatable, Identifiable {
    public var id: String { name }
    public let name: String
    public let state: State
    public let source: String?
    public let toolCount: Int?
    public let error: String?

    /// `plugin:team-tools:linear` reads as `linear`; the plugin goes in `origin`.
    public var displayName: String {
      guard name.hasPrefix("plugin:") else { return name }
      return name.split(separator: ":", maxSplits: 2).last.map(String.init) ?? name
    }

    /// Where the server's config came from, as the user would name it.
    public var origin: String? {
      if name.hasPrefix("plugin:") {
        let parts = name.split(separator: ":")
        return parts.count == 3 ? "\(parts[1]) plugin" : "Plugin"
      }
      switch source {
      case "claudeai": return "claude.ai connector"
      case "user": return "User config"
      case "project": return "Project .mcp.json"
      case "local": return "Local config"
      case "dynamic": return "Argus"
      case let other?: return other.capitalized
      case nil: return nil
      }
    }
  }

  /// Nil when the agent's CLI can't report MCP status.
  public let servers: [Server]?
  /// The Claude account the agent runs as; nil from an older host.
  public let accountId: String?

  public init(_ result: ArgusProtocol.MethodsTypes.AgentsMcpStatusResult) {
    servers = result.servers.map { list in
      list.map {
        Server(
          name: $0.name, state: State($0.status), source: $0.source,
          toolCount: $0.toolCount.map { Int($0) }, error: $0.error)
      }
      .sorted {
        $0.state.rank != $1.state.rank
          ? $0.state.rank < $1.state.rank
          : $0.displayName.localizedStandardCompare($1.displayName) == .orderedAscending
      }
    }
    accountId = result.accountId
  }

  public var connectedCount: Int { servers?.count { $0.state == .connected } ?? 0 }

  /// Servers that won't work until someone acts: failed or waiting on a sign-in.
  public var problemCount: Int {
    servers?.count { $0.state == .failed || $0.state == .needsAuth } ?? 0
  }
}
