import ArgusCore
import Foundation

/// The account's side effects on this Mac: telemetry for what only the app
/// sees, and handing new log entries to every host it is connected to.
extension DesktopModel {
  func wireAccount() {
    account.onEvent = { event in
      switch event {
      case .joinActed(let action, let role):
        MacTelemetry.capture(.accountJoinActed(action: action, role: role))
      case .memberRemoved(let role):
        MacTelemetry.capture(.accountMemberChanged(action: .removed, role: role))
      case .memberRenamed(let role):
        MacTelemetry.capture(.accountMemberChanged(action: .renamed, role: role))
      case .nameChanged(let source, let linked):
        MacTelemetry.capture(.deviceNameChanged(source: source, linked: linked))
      case .accountReset(let action):
        MacTelemetry.capture(.accountReset(action: action))
      case .sessionLost(let reason):
        MacTelemetry.capture(.accountSessionLost(reason: reason))
      case .localHost(let outcome):
        MacTelemetry.capture(.accountLocalHost(outcome: outcome))
      case .signedIn, .signedOut, .computerAdded, .pushRegistered:
        break
      }
    }
    // One name for this Mac and its host: set here, from the list, or from another device.
    account.onNameChanged = { name in
      AppPreferences.shared.deviceName = name == AppPreferences.systemDeviceName ? "" : name
    }
    // A removal reaches connected hosts at once, not at their next poll.
    account.onLogAppended = { [weak self] in
      Task { await self?.syncAccountHosts() }
    }
  }

  /// `account.sync` to this Mac's own host and every connected remote one.
  func syncAccountHosts() async {
    if let localBackend { await account.sync(over: .backend(localBackend)) }
    for hostId in hosts.machines where hostId != Hosts.local {
      await syncAccount(hostId)
    }
  }

  /// One host came (back) up: give it anything it missed while away.
  func syncAccount(_ hostId: HostId) async {
    guard hosts.state(hostId) == .ready, let link = backend?.link(hostId) else { return }
    await account.sync(over: .link(link))
  }
}
