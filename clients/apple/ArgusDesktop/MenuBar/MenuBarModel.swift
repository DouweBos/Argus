import AppKit
import ArgusCore
import ArgusMenuBar
import Foundation
import Observation

/// The menu-bar item's live state and what its items do, over this Mac's own
/// host. Pairing and the account section are the server's shared ones.
@MainActor
@Observable
final class MenuBarModel {
  let pairing = PairingModel()
  let accountMenu = HostAccountMenu(surface: .mac)
  let loginItem = LoginItem.mainApp
  private(set) var remote: ArgusProtocol.RemoteStatus?
  private(set) var loginState: LoginItemState = .off
  @ObservationIgnored weak var model: DesktopModel?
  /// Scene actions, handed over by the menu's label once it's on screen.
  @ObservationIgnored var openWindow: ((String) -> Void)?
  @ObservationIgnored var openSettings: (() -> Void)?
  @ObservationIgnored private var poller: Task<Void, Never>?

  /// Wires the model to the app's host; called once from `DesktopModel.init`.
  func install(on model: DesktopModel) {
    self.model = model
    // Only the app running the host pairs devices with it or puts it on an account.
    pairing.backend = { [weak model] in model?.isAttached == false ? model?.localBackend : nil }
    accountMenu.backend = { [weak model] in model?.isAttached == false ? model?.localBackend : nil }
    pairing.onStage = { [weak self] stage, client, _ in
      MacTelemetry.capture(.pairing(stage: .init(stage), client: client))
      if stage == .started, case .waitingForDevice(_, let code) = self?.pairing.flow.phase {
        HostAccountMenu.copy(code)
      }
    }
    pairing.onPaired = { [weak self] in Task { await self?.refreshRemote() } }
    accountMenu.onShow = { [weak self] window in self?.show(window) }
    accountMenu.onPerformed = { action in
      if let mac = MacTelemetryEvent.MenuBarAction(action) { MacTelemetry.capture(.menuBarUsed(action: mac)) }
    }
    _ = model.store.observeIpc { [weak self] channel, args, _ in
      self?.ipc(channel: channel, payload: args.first ?? .null)
    }
    refreshLoginState()
  }

  private func ipc(channel: String, payload: JSONValue) {
    guard model?.isAttached == false else { return }
    if channel == "remote:status" {
      if let next = try? ProtocolCodec.convert(payload, to: ArgusProtocol.RemoteStatus.self) { remote = next }
      return
    }
    if accountMenu.handle(channel: channel, payload: payload) { return }
    // Settings → Remote pairs on its own model; only follow a pairing started here.
    if pairing.isActive { pairing.handle(channel: channel, payload: payload) }
  }

  // MARK: Refresh

  /// The host (re)connected: what the menu reads, and a slow poll for join requests.
  func reconnected() async {
    guard model?.isAttached == false else { return }
    await refreshRemote()
    await accountMenu.refreshAccount()
    await accountMenu.refreshRequests()
    guard poller == nil else { return }
    // Join requests and presence need the network; a minute is plenty.
    poller = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(60))
        guard let self else { return }
        refreshLoginState()
        if AppPreferences.shared.showInMenuBar { await accountMenu.refreshRequests() }
      }
    }
  }

  func refreshRemote() async {
    guard let backend = model?.localBackend else { return }
    remote = (try? await backend.request(ArgusProtocol.Commands.RemoteGetStatus.self, .init())) ?? remote
  }

  func refreshLoginState() {
    loginState = loginItem.state
  }

  func stop() {
    poller?.cancel()
    poller = nil
    pairing.close()
  }

  // MARK: Menu

  var snapshot: DesktopMenuSnapshot? {
    guard let model else { return nil }
    return DesktopMenuSnapshot(
      host: model.supervisor.state, attached: model.isAttached,
      agents: model.store.statusByAgent.values.filter { $0.status != .stopped },
      canPair: remote?.enabled == true && remote?.publicUrl != nil, pairing: pairing.flow.phase,
      account: accountMenu.snapshot(tunnel: remote?.managedTunnel, inlineSettings: false),
      canCheckForUpdates: model.updater.isConfigured ? model.updater.canCheck : nil, loginItem: loginState)
  }

  var items: [HostMenuItem] { snapshot.map(DesktopMenuModel.items) ?? [] }

  var activeAgents: Int {
    model.map { HostMenuModel.activeCount(Array($0.store.statusByAgent.values)) } ?? 0
  }
}
