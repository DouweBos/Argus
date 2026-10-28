import AppKit
import ArgusCore
import ArgusMenuBar

/// What the Mac app's menu-bar menu shows, as plain values.
struct DesktopMenuSnapshot {
  var host: HostSupervisor.State
  /// A second window on another app's host: its pairing and account aren't ours.
  var attached: Bool
  var agents: [RemoteAgentStatus]
  /// Remote access is on with an address a device can reach.
  var canPair: Bool
  var pairing: PairingFlow.Phase
  var account: AccountMenuSnapshot?
  /// Nil when this build has no update feed.
  var canCheckForUpdates: Bool?
  var loginItem: LoginItemState
}

/// A companion to the window, not a second one: what needs you, what's
/// running, and the few things that come up while the window is away
/// (a device to pair, a join to approve). The window has everything else.
enum DesktopMenuModel {
  static func items(_ s: DesktopMenuSnapshot) -> [HostMenuItem] {
    var out: [HostMenuItem] = [.action("Open Argus", .openApp), .separator]
    out += HostMenuModel.hostItems(s.host)
    guard HostMenuModel.isUp(s.host) else { return out + [.separator] + appItems(s) }
    out += [.separator] + HostMenuModel.activeAgents(s.agents)
    if !s.attached {
      out += [.separator] + pairingItems(s)
      if let account = s.account {
        out += [.separator] + AccountMenuModel.items(account)
      }
    }
    return out + [.separator] + appItems(s)
  }

  /// Pairing needs remote access; when it's off, Settings is where it's turned on.
  static func pairingItems(_ s: DesktopMenuSnapshot) -> [HostMenuItem] {
    if case .idle = s.pairing, !s.canPair {
      return [.action("Pair a device…", .openRemoteSettings)]
    }
    return HostMenuModel.pairingItems(s.pairing)
  }

  static func appItems(_ s: DesktopMenuSnapshot) -> [HostMenuItem] {
    var out: [HostMenuItem] = []
    if let canCheck = s.canCheckForUpdates {
      out.append(.action("Check for Updates…", .checkForUpdates, enabled: canCheck))
    }
    out += HostMenuModel.loginItems(s.loginItem)
    return out + [.action("Settings…", .openSettings), .action("Quit Argus", .quit)]
  }
}

/// Argus Server, native or Electron: both use this bundle id. Installed, it
/// already puts an Argus icon in the menu bar.
enum InstalledServer {
  static let bundleId = "dev.houwert.argus.server"

  static func isInstalled(workspace: NSWorkspace = .shared) -> Bool {
    workspace.urlForApplication(withBundleIdentifier: bundleId) != nil
  }
}
