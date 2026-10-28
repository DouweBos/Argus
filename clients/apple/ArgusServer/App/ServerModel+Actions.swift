import AppKit
import ArgusCore
import ArgusMenuBar
import Foundation

/// What each menu item does. Every account action calls the same host command
/// the Electron tray's console words reach, so the two can't drift.
extension ServerModel {
  func perform(_ action: HostMenuAction) {
    switch action {
    case .revealState:
      NSWorkspace.shared.activateFileViewerSelecting([location.home])
    case .restartHost:
      ServerTelemetry.capture(.menuAction(action: .restartHost))
      supervisor.retry()
    case .takeOver:
      confirmTakeOver()
    case .copyAddress(let address):
      copy(address)
    case .openAgent(let agentId):
      ServerTelemetry.capture(.menuAction(action: .openAgent))
      var components = URLComponents(url: webClientURL, resolvingAgainstBaseURL: false)!
      components.queryItems = [URLQueryItem(name: "agent", value: agentId)]
      NSWorkspace.shared.open(components.url!)
    case .openWebClient:
      ServerTelemetry.capture(.menuAction(action: .openWeb))
      NSWorkspace.shared.open(webClientURL)
    case .openLogs:
      ServerTelemetry.capture(.menuAction(action: .openLogs))
      NSWorkspace.shared.activateFileViewerSelecting([supervisor.configuration.logFile])
    case .pair:
      ServerTelemetry.capture(.menuAction(action: .pair))
      show(.pairing)
      Task { await pairing.start() }
    case .showPairing:
      show(.pairing)
    case .cancelPairing, .dismissPairing:
      pairing.close()
    case .confirmPairing(let control, let admin):
      pairing.flow.grantAdmin = admin
      pairing.flow.grantControl = control || admin
      Task { await pairing.confirm() }
    case .account(let account):
      runAccount(account)
    case .checkForUpdates:
      updater.check()
    case .downloadUpdate:
      updater.download()
    case .installUpdate:
      if case .agentsRunning = updater.install(activeAgents: activeAgents) {
        ServerTelemetry.capture(.update(stage: .blockedByAgents))
      }
    case .toggleAutoInstall:
      Task { await setAutoInstall(!autoInstall) }
    case .toggleOpenAtLogin:
      setOpenAtLogin(loginState == .off || loginState == .unavailable)
    case .openLoginItemsSettings:
      LoginItem.openSystemSettings()
    case .migrateLoginItem:
      offerLoginMigration()
    case .openSettings:
      NSApp.activate()
      openSettings?()
    case .openApp, .openRemoteSettings, .openAccountSettings:
      break
    case .quit:
      ServerTelemetry.capture(.menuAction(action: .quit))
      onQuit?()
    }
  }

  // MARK: Windows

  func show(_ window: HostMenuWindow) {
    NSApp.activate()
    openWindow?(window.rawValue)
  }

  func open(_ target: ServerNotifier.Target) {
    switch target {
    case .pairing: show(.pairing)
    case .joinRequest(let id): runAccount(.approve(requestId: id))
    }
  }

  func copy(_ text: String) {
    HostAccountMenu.copy(text)
  }

  func runAccount(_ action: AccountMenuAction) {
    accountMenu.run(action)
  }

  // MARK: Host

  /// Taking over quits the other app and its agents with it, so it asks.
  private func confirmTakeOver() {
    let holder: HostLockRecord
    switch supervisor.state {
    case .locked(let record), .attached(let record): holder = record
    default: return
    }
    guard ServerPrompts.confirmTakeOver(holder) else { return }
    ServerTelemetry.capture(.menuAction(action: .takeOver))
    supervisor.takeOver()
  }

  // MARK: Login item

  func setOpenAtLogin(_ on: Bool) {
    do {
      try loginItem.setEnabled(on)
    } catch {
      notice = "Couldn't change Open at Login: \(error.localizedDescription)"
    }
    refreshLoginState()
    ServerTelemetry.capture(.loginItem(enabled: on, status: loginState.telemetry))
  }

  /// The Electron server's launch agent still starts `Argus Server.app` at
  /// login. Replace it with this app's login item, once the user says so.
  func offerLoginMigration() {
    let oldServerRunning = if case .locked(let holder) = supervisor.state { holder.owner == .electron } else { false }
    guard legacyAgent.isInstalled, ServerPrompts.confirmLoginMigration(oldServerRunning: oldServerRunning) else { return }
    migrateLoginItem()
  }

  private func migrateLoginItem() {
    let underOldAgent = LegacyServerAgent.isRunningUnder()
    do {
      try legacyAgent.moveAside()
      try loginItem.setEnabled(true)
      oldLoginAgent = false
      refreshLoginState()
      ServerTelemetry.capture(.migrated(from: .electronAgent, success: true))
    } catch {
      notice = "Couldn't replace the old login agent: \(error.localizedDescription)"
      ServerTelemetry.capture(.migrated(from: .electronAgent, success: false))
      return
    }
    // Unloading the old job stops its process. When that's us, leave it: the
    // plist is gone, so it ends at logout and the new login item takes over.
    if !underOldAgent {
      ServerProcess.detached(LegacyServerAgent.bootoutCommand())
    }
  }
}
