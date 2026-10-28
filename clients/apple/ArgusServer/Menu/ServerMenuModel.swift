import ArgusCore
import ArgusMenuBar
import ArgusUpdate
import Foundation

/// Everything the menu shows, as plain values. `ServerModel` fills it from the
/// supervisor and the host; `ServerMenuModel.items` turns it into lines.
struct ServerMenuSnapshot {
  var version: String
  var host: HostSupervisor.State
  /// The gateway port, when it's up.
  var port: Int?
  /// `~/.argus-server`, as the menu shows it.
  var stateDir: String
  var remote: ArgusProtocol.RemoteStatus?
  var agents: [ArgusProtocol.RemoteAgentStatus]
  /// Nil until the host answered; an older host may never.
  var account: AccountMenuSnapshot?
  var pairing: PairingFlow.Phase
  var update: UpdateState
  var autoInstall: Bool
  var loginItem: LoginItemState
  /// Stores the Electron server still has to move to the keychain format.
  var legacySecrets: [String]
  /// The Electron server's hand-installed login agent is still in place.
  var oldLoginAgent: Bool
}

enum ServerMenuModel {
  static func items(_ s: ServerMenuSnapshot) -> [HostMenuItem] {
    var out = statusItems(s)
    guard HostMenuModel.isUp(s.host) else {
      return out + [.separator] + appItems(s)
    }
    out += [.separator] + HostMenuModel.agentTree(s.agents)
    if let account = s.account {
      out += [.separator] + AccountMenuModel.items(account)
    }
    out += [.separator] + HostMenuModel.pairingItems(s.pairing)
    out += [.separator] + updateItems(s)
    out += [.separator] + openItems()
    return out + [.separator] + appItems(s)
  }

  // MARK: Status

  static func statusItems(_ s: ServerMenuSnapshot) -> [HostMenuItem] {
    var out: [HostMenuItem] = [.info("Argus Server \(s.version)")]
    out += hostItems(s.host)
    if s.host == .running, let port = s.port {
      out.append(.info("Gateway: ws://127.0.0.1:\(port)"))
      if let lan = s.remote?.lanUrl { out.append(.info("Local network: \(AccountMenuModel.withoutScheme(lan))")) }
      if let tailnet = s.remote?.tailscaleUrl {
        out.append(.info("Tailscale: \(AccountMenuModel.withoutScheme(tailnet))"))
      }
      if let address = s.remote?.publicUrl ?? s.remote?.lanUrl {
        out.append(.action("Copy Address", .copyAddress(address)))
      }
    }
    out.append(.action("State: \(s.stateDir)", .revealState))
    if !s.legacySecrets.isEmpty {
      out.append(
        .info("\(s.legacySecrets.joined(separator: " and ").capitalizedFirst) still in the old format — open the old Argus Server once"))
    }
    return out
  }

  /// The shared host lines, plus taking the Argus home over from whoever holds it.
  static func hostItems(_ state: HostSupervisor.State) -> [HostMenuItem] {
    switch state {
    case .locked(let holder), .attached(let holder):
      HostMenuModel.hostItems(state) + [.action(takeOverLabel(holder), .takeOver)]
    default:
      HostMenuModel.hostItems(state)
    }
  }

  static func takeOverLabel(_ holder: HostLockRecord) -> String {
    holder.owner == .electron ? "Take Over from the Old Argus Server" : "Quit \(holder.appName) and Run Here"
  }

  static func activeCount(_ agents: [ArgusProtocol.RemoteAgentStatus]) -> Int {
    HostMenuModel.activeCount(agents)
  }

  static func updateItems(_ s: ServerMenuSnapshot) -> [HostMenuItem] {
    HostMenuModel.updateItems(s.update, autoInstall: s.autoInstall, activeAgents: activeCount(s.agents))
  }

  // MARK: Open and app

  static func openItems() -> [HostMenuItem] {
    [.action("Open Web Client", .openWebClient), .action("Open Logs", .openLogs)]
  }

  static func appItems(_ s: ServerMenuSnapshot) -> [HostMenuItem] {
    var out: [HostMenuItem] = []
    if s.oldLoginAgent {
      out.append(.action("Start at Login with This App…", .migrateLoginItem))
    }
    out += HostMenuModel.loginItems(s.loginItem)
    return out + [.action("Settings…", .openSettings), .action("Quit Argus Server", .quit)]
  }
}

extension String {
  fileprivate var capitalizedFirst: String {
    prefix(1).uppercased() + dropFirst()
  }
}
