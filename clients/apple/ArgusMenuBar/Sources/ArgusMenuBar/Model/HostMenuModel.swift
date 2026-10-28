import ArgusCore
import ArgusUpdate
import Foundation

/// The sections both menus share, as pure functions of plain values. Each app
/// composes its menu from these plus its own lines (`ServerMenuModel`,
/// `DesktopMenuModel`).
public enum HostMenuModel {
  // MARK: Host

  /// The host's state; `Restart Host` where there is nothing else to do.
  public static func hostItems(_ state: HostSupervisor.State) -> [HostMenuItem] {
    switch state {
    case .idle, .starting, .holderExited, .waitingForHost:
      [.info("Host: starting…")]
    case .running:
      [.info("Host: running")]
    case .restarting(let attempt):
      [.info("Host: restarting (\(attempt))")]
    case .failed(let message):
      [.info("Host: failed"), .info(message), .action("Restart Host", .restartHost)]
    case .locked(let holder):
      [.info("Host: \(holder.holderName) is running on this Argus home")]
    case .attached(let holder):
      [.info("Host: attached to \(holder.appName)")]
    case .handingOver(let holder):
      [.info("Host: waiting for \(holder.appName) to quit…")]
    case .stopped:
      [.info("Host: stopped"), .action("Restart Host", .restartHost)]
    }
  }

  /// Running, or attached to another app's host: either way there is one to talk to.
  public static func isUp(_ state: HostSupervisor.State) -> Bool {
    switch state {
    case .running, .attached: true
    default: false
    }
  }

  // MARK: Agents

  public static func isActive(_ agent: ArgusProtocol.RemoteAgentStatus) -> Bool {
    agent.status == .running || agent.status == .requiresAction
  }

  public static func activeCount(_ agents: [ArgusProtocol.RemoteAgentStatus]) -> Int {
    agents.filter(isActive).count
  }

  /// Project → session → agent, newest activity first, as the Electron tray.
  public static func agentTree(_ agents: [ArgusProtocol.RemoteAgentStatus]) -> [HostMenuItem] {
    guard !agents.isEmpty else { return [.info("No agents running")] }
    let active = activeCount(agents)
    var out: [HostMenuItem] = [
      .info("\(agents.count) agent\(agents.count == 1 ? "" : "s") · \(active) active")
    ]
    let newest = { (list: [ArgusProtocol.RemoteAgentStatus]) in list.map { $0.createdAt ?? 0 }.max() ?? 0 }
    let byProject = Dictionary(grouping: agents) { $0.projectName ?? "Project" }
    for (project, projectAgents) in byProject.sorted(by: { newest($0.value) > newest($1.value) }) {
      let bySession = Dictionary(grouping: projectAgents, by: \.sessionId)
      let sessions = bySession.values.sorted { newest($0) > newest($1) }.map { sessionAgents -> HostMenuItem in
        let label = sessionAgents.first?.sessionLabel ?? "Session"
        let leaves = sessionAgents.sorted { ($0.createdAt ?? 0) < ($1.createdAt ?? 0) }.map { agent in
          HostMenuItem.action("\(dot(isActive(agent))) \(agent.title ?? "Agent")", .openAgent(agent.agentId))
        }
        return .submenu("\(dot(sessionAgents.contains(where: isActive))) \(label)  (\(sessionAgents.count))", leaves)
      }
      out.append(.submenu("\(dot(projectAgents.contains(where: isActive))) \(project)  (\(projectAgents.count))", sessions))
    }
    return out
  }

  /// Only the agents worth a glance — those waiting on you, then those working —
  /// flat, each opening where it lives; the window has the rest.
  public static func activeAgents(_ agents: [ArgusProtocol.RemoteAgentStatus], limit: Int = 8) -> [HostMenuItem] {
    let waiting = agents.filter { $0.status == .requiresAction }.sorted(by: newestFirst)
    let running = agents.filter { $0.status == .running }.sorted(by: newestFirst)
    guard !waiting.isEmpty || !running.isEmpty else { return [.info("No agents running")] }
    var out: [HostMenuItem] = []
    if !waiting.isEmpty {
      out.append(.info("Needs you (\(waiting.count))"))
      out += waiting.prefix(limit).map(agentLine)
    }
    if !running.isEmpty {
      out.append(.info("Running (\(running.count))"))
      out += running.prefix(limit).map(agentLine)
    }
    return out
  }

  private static func agentLine(_ agent: ArgusProtocol.RemoteAgentStatus) -> HostMenuItem {
    let title = agent.title ?? "Agent"
    let label = agent.sessionLabel.map { "\(title) — \($0)" } ?? title
    return .action(label, .openAgent(agent.agentId))
  }

  private static func newestFirst(_ a: ArgusProtocol.RemoteAgentStatus, _ b: ArgusProtocol.RemoteAgentStatus) -> Bool {
    (a.createdAt ?? 0) > (b.createdAt ?? 0)
  }

  private static func dot(_ active: Bool) -> String { active ? "●" : "○" }

  // MARK: Pairing

  /// The SAS is shown so a human can compare it with the device's screen, and
  /// the grants are separate items so admin is never the obvious click.
  public static func pairingItems(_ phase: PairingFlow.Phase) -> [HostMenuItem] {
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
      var out: [HostMenuItem] = [
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

  /// The running version is already named elsewhere, so only the new one is;
  /// restarting is refused with a count rather than hidden.
  public static func updateItems(_ update: UpdateState, autoInstall: Bool, activeAgents: Int) -> [HostMenuItem] {
    let check = HostMenuItem.action("Check for Updates…", .checkForUpdates)
    var out: [HostMenuItem]
    switch update {
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
      out = [.info("Update ready: \(version)"), installItem(update, activeAgents: activeAgents)]
    case .installing:
      out = [.info("Installing update…")]
    case .failed(let message):
      out = [.info("Update failed: \(message)"), check]
    }
    return out + [.toggle("Install Automatically When Idle", isOn: autoInstall, .toggleAutoInstall)]
  }

  public static func installItem(_ update: UpdateState, activeAgents: Int) -> HostMenuItem {
    if case .agentsRunning(let n) = InstallVerdict(state: update, activeAgents: activeAgents) {
      return .info("\(n) agent\(n == 1 ? "" : "s") running — cannot restart")
    }
    return .action("Restart and Install", .installUpdate)
  }

  // MARK: Login item

  /// Open at Login, and where to allow it when macOS wants approval first.
  public static func loginItems(_ state: LoginItemState) -> [HostMenuItem] {
    switch state {
    case .requiresApproval:
      [
        .toggle("Open at Login", isOn: true, .toggleOpenAtLogin),
        .action("Allow in Login Items…", .openLoginItemsSettings),
      ]
    case .enabled:
      [.toggle("Open at Login", isOn: true, .toggleOpenAtLogin)]
    case .off, .unavailable:
      [.toggle("Open at Login", isOn: false, .toggleOpenAtLogin)]
    }
  }
}
