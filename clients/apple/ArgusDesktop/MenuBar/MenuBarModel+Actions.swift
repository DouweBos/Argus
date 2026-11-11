import AppKit
import ArgusCore
import ArgusMenuBar

/// What each menu-bar item does. Agents open in the window, not a browser.
extension MenuBarModel {
  func perform(_ action: HostMenuAction) {
    guard let model else { return }
    switch action {
    case .openApp:
      track(.openApp)
      showMain()
    case .openAgent(let agentId):
      track(.openAgent)
      guard let agent = model.store.statusByAgent[agentId] else { return showMain() }
      showMain()
      model.navigate(.session(id: agent.sessionId, agentId: agentId))
    case .restartHost:
      track(.restartHost)
      model.supervisor.retry()
    case .pair:
      track(.pair)
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
    case .openRemoteSettings:
      track(.openSettings)
      showSettings(.remote)
    case .account(let account):
      accountMenu.run(account)
    case .openAccountSettings:
      track(.openSettings)
      showSettings(.account)
    case .checkForUpdates:
      track(.checkForUpdates)
      model.checkForUpdates()
    case .toggleOpenAtLogin:
      setOpenAtLogin(loginState == .off || loginState == .unavailable)
    case .openLoginItemsSettings:
      LoginItem.openSystemSettings()
    case .openSettings:
      track(.openSettings)
      NSApp.activate()
      openSettings?()
    case .quit:
      track(.quit)
      AppDelegate.current?.quit()
    case .takeOver, .revealState, .copyAddress, .openWebClient, .openLogs, .downloadUpdate, .installUpdate,
      .toggleAutoInstall, .migrateLoginItem:
      // Server only; Sparkle's own window downloads and installs here.
      break
    }
  }

  func show(_ window: HostMenuWindow) {
    NSApp.activate()
    openWindow?(window.rawValue)
  }

  /// The main window, reopened if it was closed.
  func showMain() {
    NSApp.activate()
    openWindow?("main")
  }

  private func showSettings(_ tab: SettingsTab) {
    model?.settingsTab = tab
    NSApp.activate()
    openSettings?()
  }

  func setOpenAtLogin(_ on: Bool) {
    do {
      try loginItem.setEnabled(on)
    } catch {
      model?.notificationsLog.push(
        .error, "Couldn't change Open at Login: \(error.localizedDescription)", source: "Menu Bar")
    }
    refreshLoginState()
    MacTelemetry.capture(.loginItem(enabled: on, status: .init(loginState)))
  }

  private func track(_ action: MacTelemetryEvent.MenuBarAction) {
    MacTelemetry.capture(.menuBarUsed(action: action))
  }
}

extension MacTelemetryEvent.MenuBarAction {
  /// The account actions the Mac's menu offers; managing the account is Settings'.
  init?(_ action: AccountMenuAction) {
    switch action {
    case .linkStart: self = .link
    case .approve: self = .approveJoin
    case .deny: self = .denyJoin
    default: return nil
    }
  }
}

extension MacTelemetryEvent.LoginItemStatus {
  init(_ state: LoginItemState) {
    switch state {
    case .enabled: self = .enabled
    case .requiresApproval: self = .requiresApproval
    case .off, .unavailable: self = .off
    }
  }
}
