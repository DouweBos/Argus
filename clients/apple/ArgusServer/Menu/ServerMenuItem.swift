import Foundation

/// One line of the menu-bar menu. A plain value, so the whole menu is built by
/// pure functions and tested without AppKit, like the Electron tray's model.
indirect enum ServerMenuItem: Equatable {
  /// A disabled line of text.
  case info(String)
  case action(String, ServerMenuAction, enabled: Bool = true)
  case toggle(String, isOn: Bool, ServerMenuAction)
  case submenu(String, [ServerMenuItem], enabled: Bool = true)
  case separator

  var label: String? {
    switch self {
    case .info(let label), .action(let label, _, _), .toggle(let label, _, _), .submenu(let label, _, _): label
    case .separator: nil
    }
  }
}

/// What a menu item does; `ServerModel.perform` carries it out.
enum ServerMenuAction: Equatable {
  // Host
  case revealState
  case restartHost
  case takeOver
  case copyAddress(String)
  // Agents
  case openAgent(String)
  // Open
  case openWebClient
  case openLogs
  // Pairing
  case pair
  case showPairing
  case cancelPairing
  case confirmPairing(control: Bool, admin: Bool)
  case dismissPairing
  // Account
  case account(AccountMenuAction)
  // Updates
  case checkForUpdates
  case downloadUpdate
  case installUpdate
  case toggleAutoInstall
  // App
  case toggleOpenAtLogin
  case openLoginItemsSettings
  case migrateLoginItem
  case openSettings
  case quit
}

/// The account section's actions: what `login`, `approve`, `account` and
/// `logout` do in `argus-host`'s console, as in the Electron tray.
enum AccountMenuAction: Equatable {
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
  case renameDefault
  case rename(current: String)
  case tunnel(on: Bool)
  case unlink
}
