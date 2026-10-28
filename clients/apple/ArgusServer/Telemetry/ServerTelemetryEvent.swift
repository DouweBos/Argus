import ArgusCore
import ArgusMenuBar
import Foundation

/// Every event Argus Server sends itself — the analogue of
/// `MacTelemetryEvent`, so the wrong props don't compile.
///
/// The host already captures what it does (`agent_started`, account and
/// tunnel events, …), so only what the host cannot see is here: the app, its
/// supervisor, the menu, pairing outcomes, updates, the login item and the
/// move from the Electron server. Never names, paths, URLs or codes.
enum ServerTelemetryEvent {
  enum LoginItemStatus: String {
    case enabled
    case requiresApproval = "requires_approval"
    case off
  }

  enum HostStage: String {
    case started
    case crashed
    case gaveUp = "gave_up"
    case lockConflict = "lock_conflict"
    case handover
  }

  enum Holder: String {
    case electron
    case mac
    case macServer = "mac_server"
    case cli

    init(_ owner: HostLockRecord.Owner) {
      switch owner {
      case .electron: self = .electron
      case .mac: self = .mac
      case .macServer: self = .macServer
      case .cli: self = .cli
      }
    }
  }

  enum MenuAction: String {
    case pair
    case link
    case approveJoin = "approve_join"
    case denyJoin = "deny_join"
    case rename
    case unlink
    case toggleTunnel = "toggle_tunnel"
    case openWeb = "open_web"
    case openAgent = "open_agent"
    case openLogs = "open_logs"
    case restartHost = "restart_host"
    case takeOver = "take_over"
    case quit
  }

  enum PairingStage: String {
    case confirmed
    case rejected
    case failed
    case cancelled
  }

  enum Grant: String {
    case monitor
    case control
    case admin
    case none
  }

  enum UpdateStage: String {
    case checked
    case downloaded
    case installed
    case blockedByAgents = "blocked_by_agents"
    case autoInstalled = "auto_installed"
    case failed
  }

  enum MigrationSource: String {
    case electronAgent = "electron_agent"
    case electronRunning = "electron_running"
  }

  /// The app started; how it starts at login, and whether launchd started it.
  case launched(loginItem: LoginItemStatus, launchedByLaunchd: Bool)
  /// The supervisor moved; `restarts`, `exitCode`, `holder` and `success` only where they apply.
  case host(stage: HostStage, restarts: Int?, exitCode: Int?, holder: Holder?, success: Bool?)
  /// A menu item or window button that does something.
  case menuAction(action: MenuAction)
  /// A pairing settled, with the grant it was given.
  case pairing(stage: PairingStage, grant: Grant)
  case update(stage: UpdateStage)
  /// Open at Login was switched.
  case loginItem(enabled: Bool, status: LoginItemStatus)
  /// The Electron server's login agent or running host was replaced by this app.
  case migrated(from: MigrationSource, success: Bool)

  var name: String {
    switch self {
    case .launched: "mac_server_launched"
    case .host: "mac_server_host"
    case .menuAction: "mac_server_menu_action"
    case .pairing: "mac_server_pairing"
    case .update: "mac_server_update"
    case .loginItem: "mac_server_login_item"
    case .migrated: "mac_server_migrated"
    }
  }

  var properties: [String: Any] {
    switch self {
    case .launched(let loginItem, let launchedByLaunchd):
      ["login_item": loginItem.rawValue, "launched_by_launchd": launchedByLaunchd]
    case .host(let stage, let restarts, let exitCode, let holder, let success):
      [
        "stage": stage.rawValue as Any?, "restarts": restarts as Any?, "exit_code": exitCode as Any?,
        "holder": holder?.rawValue as Any?, "success": success as Any?,
      ].compactMapValues { $0 }
    case .menuAction(let action):
      ["action": action.rawValue]
    case .pairing(let stage, let grant):
      ["stage": stage.rawValue, "grant": grant.rawValue]
    case .update(let stage):
      ["stage": stage.rawValue]
    case .loginItem(let enabled, let status):
      ["enabled": enabled, "status": status.rawValue]
    case .migrated(let from, let success):
      ["from": from.rawValue, "success": success]
    }
  }
}

extension LoginItemState {
  var telemetry: ServerTelemetryEvent.LoginItemStatus {
    switch self {
    case .enabled: .enabled
    case .requiresApproval: .requiresApproval
    case .off, .unavailable: .off
    }
  }
}

extension ServerTelemetryEvent.MenuAction {
  /// The account actions worth counting; the rest only move a flow along.
  init?(_ action: AccountMenuAction) {
    switch action {
    case .linkStart: self = .link
    case .approve: self = .approveJoin
    case .deny: self = .denyJoin
    case .tunnel: self = .toggleTunnel
    case .rename, .renameDefault: self = .rename
    case .unlink: self = .unlink
    default: return nil
    }
  }
}
