import ArgusCore
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
  static func items(_ s: ServerMenuSnapshot) -> [ServerMenuItem] {
    var out = statusItems(s)
    guard s.host == .running || isAttached(s.host) else {
      return out + [.separator] + appItems(s)
    }
    out += [.separator] + agentItems(s.agents)
    if let account = s.account {
      out += [.separator] + AccountMenuModel.items(account)
    }
    out += [.separator] + pairingItems(s.pairing)
    out += [.separator] + updateItems(s)
    out += [.separator] + openItems()
    return out + [.separator] + appItems(s)
  }

  // MARK: Status

  static func statusItems(_ s: ServerMenuSnapshot) -> [ServerMenuItem] {
    var out: [ServerMenuItem] = [.info("Argus Server \(s.version)")]
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

  static func hostItems(_ state: HostSupervisor.State) -> [ServerMenuItem] {
    switch state {
    case .idle, .starting:
      return [.info("Host: starting…")]
    case .running:
      return [.info("Host: running")]
    case .restarting(let attempt):
      return [.info("Host: restarting (\(attempt))")]
    case .failed(let message):
      return [.info("Host: failed"), .info(message), .action("Restart Host", .restartHost)]
    case .locked(let holder), .attached(let holder):
      let attached = if case .attached = state { true } else { false }
      return [
        .info(attached ? "Host: attached to \(holder.appName)" : "Host: \(holder.holderName) is running on this Argus home"),
        .action(takeOverLabel(holder), .takeOver),
      ]
    case .handingOver(let holder):
      return [.info("Host: waiting for \(holder.appName) to quit…")]
    case .holderExited, .waitingForHost:
      return [.info("Host: starting…")]
    case .stopped:
      return [.info("Host: stopped"), .action("Restart Host", .restartHost)]
    }
  }

  static func takeOverLabel(_ holder: HostLockRecord) -> String {
    holder.owner == .electron ? "Take Over from the Old Argus Server" : "Quit \(holder.appName) and Run Here"
  }

  private static func isAttached(_ state: HostSupervisor.State) -> Bool {
    if case .attached = state { true } else { false }
  }

  // MARK: Agents

  static func isActive(_ agent: ArgusProtocol.RemoteAgentStatus) -> Bool {
    agent.status == .running || agent.status == .requiresAction
  }

  static func activeCount(_ agents: [ArgusProtocol.RemoteAgentStatus]) -> Int {
    agents.filter(isActive).count
  }

  /// Project → session → agent, newest activity first, as the Electron tray.
  static func agentItems(_ agents: [ArgusProtocol.RemoteAgentStatus]) -> [ServerMenuItem] {
    guard !agents.isEmpty else { return [.info("No agents running")] }
    let active = activeCount(agents)
    var out: [ServerMenuItem] = [
      .info("\(agents.count) agent\(agents.count == 1 ? "" : "s") · \(active) active")
    ]
    let newest = { (list: [ArgusProtocol.RemoteAgentStatus]) in list.map { $0.createdAt ?? 0 }.max() ?? 0 }
    let byProject = Dictionary(grouping: agents) { $0.projectName ?? "Project" }
    for (project, projectAgents) in byProject.sorted(by: { newest($0.value) > newest($1.value) }) {
      let bySession = Dictionary(grouping: projectAgents, by: \.sessionId)
      let sessions = bySession.values.sorted { newest($0) > newest($1) }.map { sessionAgents -> ServerMenuItem in
        let label = sessionAgents.first?.sessionLabel ?? "Session"
        let leaves = sessionAgents.sorted { ($0.createdAt ?? 0) < ($1.createdAt ?? 0) }.map { agent in
          ServerMenuItem.action("\(dot(isActive(agent))) \(agent.title ?? "Agent")", .openAgent(agent.agentId))
        }
        return .submenu("\(dot(sessionAgents.contains(where: isActive))) \(label)  (\(sessionAgents.count))", leaves)
      }
      out.append(.submenu("\(dot(projectAgents.contains(where: isActive))) \(project)  (\(projectAgents.count))", sessions))
    }
    return out
  }

  private static func dot(_ active: Bool) -> String { active ? "●" : "○" }

  // MARK: Pairing

  /// The SAS is shown so a human can compare it with the device's screen, and
  /// the grants are separate items so admin is never the obvious click.
  static func pairingItems(_ phase: PairingFlow.Phase) -> [ServerMenuItem] {
    switch phase {
    case .idle:
      return [.action("Pair a device…", .pair)]
    case .starting, .waitingForDevice:
      return [
        .info("Pairing code copied to clipboard"),
        .info("Waiting for a device to connect…"),
        .action("Show Pairing Window", .showPairing),
        .action("Cancel pairing", .cancelPairing),
      ]
    case .confirming(let sas, let client):
      var out: [ServerMenuItem] = [
        .info("Confirm this matches: \(sas)"),
        .action("Approve — watch only", .confirmPairing(control: false, admin: false)),
        .action("Approve — run agents", .confirmPairing(control: true, admin: false)),
      ]
      if PairingClientInfo.canDriveArgus(client) {
        out.append(.action("Approve — full control of this Mac", .confirmPairing(control: true, admin: true)))
      }
      return out + [.action("Reject", .cancelPairing)]
    case .confirmingSent:
      return [.info("Pairing…")]
    case .paired(let label):
      return [.info("Paired with \(label)"), .action("Dismiss", .dismissPairing)]
    case .failed(let message):
      return [.info("Pairing failed: \(message)"), .action("Dismiss", .dismissPairing)]
    }
  }

  // MARK: Updates

  /// The running version is already the first line, so only the new one is
  /// named; restarting is refused with a count rather than hidden.
  static func updateItems(_ s: ServerMenuSnapshot) -> [ServerMenuItem] {
    let check = ServerMenuItem.action("Check for Updates…", .checkForUpdates)
    var out: [ServerMenuItem]
    switch s.update {
    case .unavailable:
      return [.info("Updates aren't set up in this build")]
    case .idle:
      out = [check]
    case .checking:
      out = [.info("Checking for updates…")]
    case .upToDate:
      out = [.info("Up to date"), check]
    case .available(let version):
      out = [.info("Update available: \(version)"), .action("Download Update", .downloadUpdate)]
    case .downloading(let percent):
      out = [.info("Downloading update — \(percent)%")]
    case .ready(let version):
      out = [.info("Update ready: \(version)"), installItem(s)]
    case .installing:
      out = [.info("Installing update…")]
    case .failed(let message):
      out = [.info("Update failed: \(message)"), check]
    }
    return out + [.toggle("Install Automatically When Idle", isOn: s.autoInstall, .toggleAutoInstall)]
  }

  static func installItem(_ s: ServerMenuSnapshot) -> ServerMenuItem {
    if case .agentsRunning(let n) = InstallVerdict(state: s.update, activeAgents: activeCount(s.agents)) {
      return .info("\(n) agent\(n == 1 ? "" : "s") running — cannot restart")
    }
    return .action("Restart and Install", .installUpdate)
  }

  // MARK: Open and app

  static func openItems() -> [ServerMenuItem] {
    [.action("Open Web Client", .openWebClient), .action("Open Logs", .openLogs)]
  }

  static func appItems(_ s: ServerMenuSnapshot) -> [ServerMenuItem] {
    var out: [ServerMenuItem] = []
    if s.oldLoginAgent {
      out.append(.action("Start at Login with This App…", .migrateLoginItem))
    }
    switch s.loginItem {
    case .requiresApproval:
      out += [
        .toggle("Open at Login", isOn: true, .toggleOpenAtLogin),
        .action("Allow in Login Items…", .openLoginItemsSettings),
      ]
    case .enabled:
      out.append(.toggle("Open at Login", isOn: true, .toggleOpenAtLogin))
    case .off, .unavailable:
      out.append(.toggle("Open at Login", isOn: false, .toggleOpenAtLogin))
    }
    return out + [.action("Settings…", .openSettings), .action("Quit Argus Server", .quit)]
  }
}

extension String {
  fileprivate var capitalizedFirst: String {
    prefix(1).uppercased() + dropFirst()
  }
}
