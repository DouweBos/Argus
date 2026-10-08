import ArgusCore
import ArgusKit
import Foundation

/// Preferences and per-home picks the host keeps for both desktop apps: its
/// `app-settings.json` and UI state, which the Electron app reads and writes
/// too. `AppPreferences`, `UserDefaults` and `HomeDefaults` stay as the copy
/// views read synchronously; the host fills them on connect and every change
/// goes back to it.
///
/// The Electron app can be open on the same host (this app attached to it), so
/// the host's `prefs:changed` refetches what it names; last write wins.
@MainActor
final class HostPreferences {
  enum Slot: Hashable {
    case setting(String)
    case uiState(String)
  }

  struct Binding {
    let slot: Slot
    /// This app's value as the host stores it; nil when it has none.
    let read: () -> JSONValue?
    /// Apply the host's value here; ignores one this app can't use.
    let write: (JSONValue) -> Void
  }

  /// The host calls, so tests can stand in for it.
  struct IO {
    var getSettings: () async throws -> [String: JSONValue]
    var setSettings: ([String: JSONValue]) async throws -> Void
    var getUiState: (String) async throws -> String?
    var setUiState: (String, String) async throws -> Void
  }

  static let shared = HostPreferences(bindings: HostPreferences.desktopBindings())

  private let bindings: [Binding]
  private var io: IO?
  /// What the host holds, or what this app read back after applying it.
  private var synced: [Slot: JSONValue] = [:]
  private var pending: [Slot: JSONValue] = [:]
  private var applying = false
  private var flushTask: Task<Void, Never>?
  private var observers: [NSObjectProtocol] = []

  init(bindings: [Binding]) {
    self.bindings = bindings
  }

  /// Takes the host's values, hands it any it lacks (unless `supply` is off:
  /// a window attached to another app's host takes, never gives), then
  /// follows changes. Returns how many values this app supplied.
  @discardableResult
  func attach(_ io: IO, supply: Bool = true) async -> Int {
    self.io = io
    guard let settings = try? await io.getSettings() else { return 0 }
    var supplied = 0
    applying = true
    for binding in bindings {
      let host: JSONValue? =
        switch binding.slot {
        case .setting(let key): settings[key].flatMap { $0 == .null ? nil : $0 }
        case .uiState(let key): (try? await io.getUiState(key)).flatMap { $0 }.flatMap(Self.decode)
        }
      if let host {
        if binding.read() != host { binding.write(host) }
        synced[binding.slot] = binding.read() ?? host
      } else if let local = binding.read() {
        // Unsupplied, it still counts as seen: only a later change is sent.
        synced[binding.slot] = local
        guard supply else { continue }
        pending[binding.slot] = local
        supplied += 1
      }
    }
    applying = false
    await flush()
    observe()
    return supplied
  }

  /// Another window on the host wrote these: take its values, except one of
  /// ours still waiting to flush, which is newer.
  func hostChanged(settings keys: [String], uiState uiKeys: [String]) async {
    guard let io else { return }
    let wanted = Set(keys.map(Slot.setting) + uiKeys.map(Slot.uiState))
    let affected = bindings.filter { wanted.contains($0.slot) && pending[$0.slot] == nil }
    guard !affected.isEmpty else { return }
    let settings = keys.isEmpty ? [:] : ((try? await io.getSettings()) ?? [:])
    var ui: [String: JSONValue] = [:]
    for key in Set(uiKeys) {
      if let value = (try? await io.getUiState(key)).flatMap({ $0 }).flatMap(Self.decode) { ui[key] = value }
    }
    applying = true
    defer { applying = false }
    for binding in affected {
      let host: JSONValue? =
        switch binding.slot {
        case .setting(let key): settings[key].flatMap { $0 == .null ? nil : $0 }
        case .uiState(let key): ui[key]
        }
      guard let host, pending[binding.slot] == nil, synced[binding.slot] != host else { continue }
      if binding.read() != host { binding.write(host) }
      synced[binding.slot] = binding.read() ?? host
    }
  }

  func detach() {
    observers.forEach(NotificationCenter.default.removeObserver)
    observers = []
    flushTask?.cancel()
    io = nil
  }

  /// Something this app keeps changed: queue what differs from the host.
  func localChanged() {
    guard io != nil, !applying else { return }
    for binding in bindings {
      guard let value = binding.read(), synced[binding.slot] != value else { continue }
      synced[binding.slot] = value
      pending[binding.slot] = value
    }
    guard !pending.isEmpty, flushTask == nil else { return }
    flushTask = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(300))
      await self?.flush()
    }
  }

  func flush() async {
    flushTask = nil
    guard let io, !pending.isEmpty else { return }
    let batch = pending
    pending = [:]
    var settings: [String: JSONValue] = [:]
    for (slot, value) in batch {
      switch slot {
      case .setting(let key): settings[key] = value
      case .uiState(let key):
        if let encoded = Self.encode(value) { try? await io.setUiState(key, encoded) }
      }
    }
    if !settings.isEmpty { try? await io.setSettings(settings) }
  }

  private func observe() {
    guard observers.isEmpty else { return }
    for name in [UserDefaults.didChangeNotification, HomeDefaults.didChange] {
      observers.append(
        NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
          MainActor.assumeIsolated { self?.localChanged() }
        })
    }
  }

  static func decode(_ string: String) -> JSONValue? {
    try? JSONDecoder().decode(JSONValue.self, from: Data(string.utf8))
  }

  static func encode(_ value: JSONValue) -> String? {
    (try? JSONEncoder().encode(value)).flatMap { String(data: $0, encoding: .utf8) }
  }
}

extension HostPreferences.IO {
  /// The app's own host, over its local socket.
  static func local(_ backend: LocalBackend) -> Self {
    .init(
      getSettings: {
        let settings = try await backend.request(ArgusProtocol.Commands.GetAppSettings.self, EmptyParams())
        let json = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(settings))
        guard case .object(let fields) = json else { return [:] }
        return fields
      },
      setSettings: { fields in
        let settings = try JSONDecoder().decode(
          ArgusProtocol.AppSettings.self, from: JSONEncoder().encode(JSONValue.object(fields)))
        _ = try await backend.request(ArgusProtocol.Commands.SetAppSettings.self, .init(settings: settings))
      },
      getUiState: { key in
        try await backend.request(ArgusProtocol.Commands.UiStateGet.self, .init(key: key))
      },
      setUiState: { key, value in
        _ = try await backend.request(ArgusProtocol.Commands.UiStateSet.self, .init(key: key, value: value))
      })
  }
}
