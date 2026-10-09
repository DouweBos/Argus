import ArgusKit
import ArgusCore
import Foundation
import Observation

/// What the runtime panel shows: which platform, which device per session, the
/// devices the host can see, and which device tools are switched on. The
/// renderer's `simulatorStore`, kept with the Argus home it was picked in.
@MainActor
@Observable
final class RuntimeModel {
  enum Platform: String, CaseIterable {
    case ios
    case android
    case web
  }

  enum Mode: String {
    case simulate
    case inspect
    /// The device's log stream: the desktop's Debug tool.
    case logs
  }

  /// The key a selection is stored under when no session is open.
  static let globalKey = "__global__"

  private let store: HostStore
  private let defaults: HomeDefaults
  let streams: RuntimeStreamHub

  var platform: Platform {
    didSet { defaults.set(platform.rawValue, forKey: Keys.platform) }
  }
  var mode: Mode = .simulate
  private(set) var simulators: [ArgusProtocol.SimulatorDevice] = []
  /// Running devices and, offline, the AVDs that can be booted.
  private(set) var androidDevices: [ArgusProtocol.AndroidDevice] = []
  /// Why a platform's toolchain is unusable; nil once it answered.
  private(set) var iosToolsError: String?
  private(set) var androidToolsError: String?
  /// Devices with a boot in flight, so their buttons can't be pressed twice.
  private(set) var booting: Set<String> = []
  private(set) var enabledTools: [String: Bool] = [:]
  /// The `.argus.json` of the session on screen: disabled tools, deep links,
  /// the browser's start URL and presets.
  private(set) var projectConfig: ArgusProtocol.ArgusConfig?
  private var projectDisabledTools: Set<String> { Set(projectConfig?.tools?.disabled ?? []) }

  private var iosBySession: [String: String]
  /// Sessions (or `globalKey`) whose device panel is hidden; shown unless hidden.
  private var hiddenPanels: Set<String>
  private var androidBySession: [String: String]
  /// The page each session's browser was last on, so returning to it doesn't reload.
  var browserUrls: [String: String] = [:]
  /// Sessions whose browser has loaded its start URL this launch.
  var openedBrowsers: Set<String> = []
  /// Sessions whose browser was asked for this launch. A restored pick alone
  /// never starts Chromium; picking the browser or opening it does.
  private(set) var startedBrowsers: Set<String> = []

  func startBrowser(session: String?) {
    startedBrowsers.insert(session ?? Self.globalKey)
  }
  var browserPreset: String {
    didSet { defaults.set(browserPreset, forKey: Keys.browserPreset) }
  }

  enum Keys {
    static let platform = "runtime.platform"
    static let ios = "runtime.iosBySession"
    static let android = "runtime.androidBySession"
    static let browserPreset = "runtime.browserPreset"
    static let hiddenPanels = "runtime.hiddenPanels"
  }

  init(store: HostStore, defaults: HomeDefaults = .shared) {
    self.store = store
    self.defaults = defaults
    streams = RuntimeStreamHub(store: store)
    platform = defaults.string(forKey: Keys.platform).flatMap(Platform.init) ?? .ios
    iosBySession = defaults.dictionary(forKey: Keys.ios) as? [String: String] ?? [:]
    androidBySession = defaults.dictionary(forKey: Keys.android) as? [String: String] ?? [:]
    browserPreset = defaults.string(forKey: Keys.browserPreset) ?? "desktop"
    hiddenPanels = Set(defaults.stringArray(forKey: Keys.hiddenPanels) ?? [])
  }

  /// Picks up the picks the host handed over on connect.
  func reloadPersisted() {
    if let saved = defaults.string(forKey: Keys.platform).flatMap(Platform.init), saved != platform {
      platform = saved
    }
    iosBySession = defaults.dictionary(forKey: Keys.ios) as? [String: String] ?? [:]
    androidBySession = defaults.dictionary(forKey: Keys.android) as? [String: String] ?? [:]
    if let preset = defaults.string(forKey: Keys.browserPreset), preset != browserPreset {
      browserPreset = preset
    }
    let hidden = Set(defaults.stringArray(forKey: Keys.hiddenPanels) ?? [])
    if hidden != hiddenPanels { hiddenPanels = hidden }
  }

  // MARK: Panel

  func panelVisible(session: String?) -> Bool {
    !hiddenPanels.contains(session ?? Self.globalKey)
  }

  func setPanelVisible(_ visible: Bool, session: String?) {
    let key = session ?? Self.globalKey
    if visible { hiddenPanels.remove(key) } else { hiddenPanels.insert(key) }
    defaults.set(hiddenPanels.sorted(), forKey: Keys.hiddenPanels)
  }

  private var backend: (any HostBackend)? { store.backend }
  /// The machine whose devices the panel lists: the shown session's, or the
  /// shown machine's on the Devices screen. A device it lists routes there after.
  var hostId: HostId = Hosts.local {
    didSet {
      (store.backend as? HostRouter)?.index.preferDevices(on: hostId)
    }
  }

  // MARK: Selection

  func selectedDevice(platform: Platform, session: String?) -> String? {
    let key = session ?? Self.globalKey
    switch platform {
    case .ios: return iosBySession[key]
    case .android: return androidBySession[key]
    case .web: return nil
    }
  }

  /// Picking a device picks its platform too, in one step.
  func select(platform: Platform, device: String?, session: String?) {
    let key = session ?? Self.globalKey
    self.platform = platform
    switch platform {
    case .ios:
      iosBySession[key] = device
      defaults.set(iosBySession, forKey: Keys.ios)
    case .android:
      androidBySession[key] = device
      defaults.set(androidBySession, forKey: Keys.android)
    case .web:
      startBrowser(session: session)
    }
    MacTelemetry.capture(.runtimeTargetPicked(platform: platform.rawValue))
  }

  func simulator(_ udid: String?) -> ArgusProtocol.SimulatorDevice? {
    udid.flatMap { id in simulators.first { $0.udid == id } }
  }

  func androidDevice(_ serial: String?) -> ArgusProtocol.AndroidDevice? {
    serial.flatMap { id in androidDevices.first { $0.serial == id } }
  }

  // MARK: Popouts

  /// Popouts the host asked to close (`platform:deviceKey`), e.g. because the
  /// simulator shut down; each window closes itself when it sees its key.
  private(set) var closedPopouts: Set<String> = []

  func closePopout(_ key: String) {
    closedPopouts.insert(key)
  }

  func popoutOpened(_ key: String) {
    closedPopouts.remove(key)
  }

  // MARK: Tools

  /// The renderer's `effectiveEnabled`: on unless the user or the project
  /// switched it off, and only while what it needs is on.
  func toolEnabled(_ id: String) -> Bool {
    if projectDisabledTools.contains(id) || enabledTools[id] == false { return false }
    switch id {
    case "device-inspector": return toolEnabled("device-recording")
    case "device-debug": return toolEnabled("device-control")
    default: return true
    }
  }

  // MARK: Loading

  /// Every list the picker offers, whatever platform is showing.
  func refresh() async {
    await HostRouter.$pinned.withValue(hostId) { await refreshLists() }
  }

  private func refreshLists() async {
    guard let backend else { return }
    do {
      simulators = try await backend.request(ArgusProtocol.Commands.ListSimulators.self, .init())
      iosToolsError = nil
    } catch where Self.hostUnavailable(error) {
      // The host dropped; its last list stays and the banner says why.
    } catch {
      iosToolsError = HostStore.describe(error)
    }
    do {
      androidDevices = try await backend.request(
        ArgusProtocol.Commands.ListAndroidDevices.self, .init())
      androidToolsError = nil
    } catch where Self.hostUnavailable(error) {
    } catch {
      androidToolsError = HostStore.describe(error)
    }
    pruneSelections()
  }

  private static func hostUnavailable(_ error: Error) -> Bool {
    if case Transport.TransportError.gateway(let payload) = error { return payload.code == "unavailable" }
    return false
  }

  func loadProject(repoRoot: String?) async {
    await HostRouter.$pinned.withValue(hostId) { await loadProjectSettings(repoRoot: repoRoot) }
  }

  private func loadProjectSettings(repoRoot: String?) async {
    guard let backend else { return }
    enabledTools =
      (try? await backend.request(ArgusProtocol.Commands.GetEnabledTools.self, .init())) ?? [:]
    projectConfig =
      if let repoRoot {
        try? await backend.request(
          ArgusProtocol.Commands.ReadArgusConfig.self, .init(repoRoot: repoRoot))
      } else {
        nil
      }
  }

  /// A device that went away can't stay picked: the view would wait on it forever.
  private func pruneSelections() {
    guard iosToolsError == nil else { return }
    let udids = Set(simulators.map(\.udid))
    let pruned = iosBySession.filter { udids.contains($0.value) }
    if pruned.count != iosBySession.count {
      iosBySession = pruned
      defaults.set(iosBySession, forKey: Keys.ios)
    }
  }

  // MARK: Lifecycle

  func bootSimulator(_ udid: String) async throws {
    guard let backend, !booting.contains(udid) else { return }
    booting.insert(udid)
    defer { booting.remove(udid) }
    try await backend.request(ArgusProtocol.Commands.BootSimulator.self, .init(udid: udid))
    await refresh()
  }

  enum Repair { case erase, delete }

  /// Erases or deletes a simulator that can't boot as it is; the user confirmed.
  func repairSimulator(_ udid: String, _ action: Repair) async throws {
    guard let backend else { throw RuntimeError.offline }
    switch action {
    case .erase:
      try await backend.request(ArgusProtocol.Commands.EraseSimulator.self, .init(udid: udid))
    case .delete:
      try await backend.request(ArgusProtocol.Commands.DeleteSimulator.self, .init(udid: udid))
    }
    await refresh()
  }

  /// Boots an AVD and returns the serial it came up as.
  func bootAvd(_ name: String) async throws -> String {
    guard let backend else { throw RuntimeError.offline }
    booting.insert(name)
    defer { booting.remove(name) }
    let serial = try await backend.request(
      ArgusProtocol.Commands.BootAndroidEmulator.self, .init(avdName: name))
    await refresh()
    return serial
  }

  /// Stops capturing the device and closes its popouts, as the panel's
  /// disconnect button does on the desktop.
  func disconnect(platform: Platform, device: String) async {
    guard let backend else { return }
    switch platform {
    case .ios:
      _ = try? await backend.request(
        ArgusProtocol.Commands.DisconnectSimulator.self, .init(udid: device))
    case .android:
      _ = try? await backend.request(
        ArgusProtocol.Commands.DisconnectAndroidDevice.self, .init(serial: device))
    case .web:
      return
    }
    await refresh()
  }

  enum RuntimeError: Error { case offline }
}
