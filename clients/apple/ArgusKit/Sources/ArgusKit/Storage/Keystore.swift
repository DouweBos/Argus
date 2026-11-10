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
  /// Set: the items live in this shared group (an App Group), readable by the app's extensions.
  private let accessGroup: String?

  public init(service: String = "dev.houwert.argus", accessGroup: String? = nil) {
    self.service = service
    self.accessGroup = accessGroup
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

  // MARK: - Other items

  /// Another secret under this service, e.g. the account keys. Same access
  /// class as the pairings: this device only, never synced.
  public func readItem(_ account: String) -> Data? {
    read(account: account)
  }

  public func writeItem(_ data: Data, account: String) {
    write(data, account: account)
  }

  public func deleteItem(_ account: String) {
    SecItemDelete(baseQuery(account: account) as CFDictionary)
  }

  // MARK: - Keychain

  private func baseQuery(account: String? = nil) -> [String: Any] {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account ?? self.account,
    ]
    if let accessGroup { query[kSecAttrAccessGroup as String] = accessGroup }
    return query
  }

  private func read(account: String? = nil) -> Data? {
    var query = baseQuery(account: account)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess else { return nil }
    return item as? Data
  }

  private func write(_ data: Data, account: String? = nil) {
    let query = baseQuery(account: account)
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
