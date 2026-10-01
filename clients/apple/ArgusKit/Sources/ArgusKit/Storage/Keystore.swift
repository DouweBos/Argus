import Foundation
import Security

/// Persistent storage for this device's pairings, backed by the Keychain.
///
/// A phone can be paired with several computers; one is active at a time. Each
/// pairing is its own identity — keypair, pinned desktop key, URL — so
/// unpairing one never touches another.
public actor Keystore {
  private let service: String
  private let account = "argus.hosts"

  public init(service: String = "dev.houwert.argus") {
    self.service = service
  }

  public func load() -> PairedHosts {
    guard let data = read(),
      let decoded = try? JSONDecoder().decode(PairedHosts.self, from: data)
    else { return .empty }
    return decoded
  }

  public func save(_ state: PairedHosts) {
    guard let data = try? JSONEncoder().encode(state) else { return }
    write(data)
  }

  /// Add (or re-pair) a computer and make it the active one.
  @discardableResult
  public func add(_ identity: DeviceIdentity) -> PairedHosts {
    var current = load()
    // Re-pairing the same gateway replaces the stale grant rather than stacking.
    current.hosts.removeAll { $0.deviceId == identity.deviceId || $0.url == identity.url }
    current.hosts.append(identity)
    current.activeId = identity.deviceId
    save(current)
    return current
  }

  @discardableResult
  public func remove(deviceId: String) -> PairedHosts {
    var current = load()
    current.hosts.removeAll { $0.deviceId == deviceId }
    if current.activeId == deviceId { current.activeId = nil }
    save(current)
    return current
  }

  @discardableResult
  public func setActive(_ deviceId: String?) -> PairedHosts {
    var current = load()
    current.activeId = deviceId
    save(current)
    return current
  }

  @discardableResult
  public func update(deviceId: String, _ patch: @Sendable (inout DeviceIdentity) -> Void) -> PairedHosts {
    var current = load()
    if let index = current.hosts.firstIndex(where: { $0.deviceId == deviceId }) {
      patch(&current.hosts[index])
    }
    save(current)
    return current
  }

  // MARK: - Keychain

  private func baseQuery() -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
  }

  private func read() -> Data? {
    var query = baseQuery()
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess else { return nil }
    return item as? Data
  }

  private func write(_ data: Data) {
    let query = baseQuery()
    let attributes: [String: Any] = [
      kSecValueData as String: data,
      // The keys are useless without this device, and a background push
      // decrypt may run before first unlock — but pairings are only read once
      // the user is in the app, so first-unlock is the right bar.
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
      SecItemAdd(query.merging(attributes) { $1 } as CFDictionary, nil)
    }
  }
}
