import Foundation

/// One line of the menu-bar menu. A plain value, so the whole menu is built by
/// pure functions and tested without AppKit, like the Electron tray's model.
public indirect enum HostMenuItem: Equatable, Sendable {
  /// A disabled line of text.
  case info(String)
  case action(String, HostMenuAction, enabled: Bool = true)
  case toggle(String, isOn: Bool, HostMenuAction)
  case submenu(String, [HostMenuItem], enabled: Bool = true)
  case separator

  public var label: String? {
    switch self {
    case .info(let label), .action(let label, _, _), .toggle(let label, _, _), .submenu(let label, _, _): label
    case .separator: nil
    }
  }
}

/// What a menu item does; each app's model carries it out. Both apps share
/// one list so the common sections compose into either menu.
public enum HostMenuAction: Equatable, Sendable {
  // Host
  case restartHost
  /// Server only: quit whoever holds the Argus home and run here.
  case takeOver
  /// Server only.
  case revealState
  case copyAddress(String)
  // Agents
  case openAgent(String)
  // Open
  /// Server only.
  case openWebClient
  case openLogs
  /// Mac app: bring the main window forward.
  case openApp
  // Pairing
  case pair
  case showPairing
  case cancelPairing
  case confirmPairing(control: Bool, admin: Bool)
  case dismissPairing
  /// Mac app: remote access is off, so pairing starts in Settings.
  case openRemoteSettings
  // Account
  case account(AccountMenuAction)
  /// Mac app: the account is managed in Settings → Account.
  case openAccountSettings
  // Updates
  case checkForUpdates
  case downloadUpdate
  case installUpdate
  case toggleAutoInstall
  // App
  case toggleOpenAtLogin
  case openLoginItemsSettings
  /// Server only: replace the Electron server's launch agent.
  case migrateLoginItem
  case openSettings
  case quit
}

/// The account section's actions: what `login`, `approve`, `account` and
/// `logout` do in `argus-host`'s console, as in the Electron tray.
public enum AccountMenuAction: Equatable, Sendable {
  case approvalConfirm(match: Bool)
  case approvalDismiss
  case approve(requestId: String)
  case deny(requestId: String)
  case linkCancel
  case linkConfirm(match: Bool)
  case linkCopyCode(String)
  case linkOpen(String)
  case linkStart
  case noticeDismiss
  case resetDismiss
  case renameDefault
  case rename(current: String)
  case tunnel(on: Bool)
  case unlink
}

/// The small windows a menu line can't hold; their scene ids.
public enum HostMenuWindow: String, Sendable {
  case pairing, approval, link
}
