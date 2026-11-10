import CryptoKit
import Foundation
import Security

/// Files sealed with AES-GCM under a key that never leaves this device's
/// keychain, written in the complete data-protection class and kept out of
/// backups: unreadable while the phone is locked, and useless if copied off it.
public struct SealedFiles: Sendable {
  public let directory: URL
  private let key: Data

  public init(directory: URL, key: Data) {
    self.directory = directory
    self.key = key
  }

  /// Application Support's `name` folder, under the keychain's key; nil when
  /// the keychain can't hold one (it's locked), so nothing is kept unsealed.
  public static func app(_ name: String, service: String = "dev.houwert.argus") -> SealedFiles? {
    guard let key = SealedKey.load(service: service) else { return nil }
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
      ?? FileManager.default.temporaryDirectory
    let directory = base.appendingPathComponent(Bundle.main.bundleIdentifier ?? "Argus", isDirectory: true)
      .appendingPathComponent(name, isDirectory: true)
    return SealedFiles(directory: directory, key: key)
  }

  /// A folder inside this one, sealed under the same key.
  public func folder(_ name: String) -> SealedFiles {
    SealedFiles(directory: url(name), key: key)
  }

  public func read(_ name: String) -> Data? {
    guard let sealed = try? Data(contentsOf: url(name)),
      let box = try? AES.GCM.SealedBox(combined: sealed)
    else { return nil }
    return try? AES.GCM.open(box, using: SymmetricKey(data: key))
  }

  @discardableResult
  public func write(_ data: Data, to name: String) -> Bool {
    do {
      try prepareDirectory()
      guard let sealed = try AES.GCM.seal(data, using: SymmetricKey(data: key)).combined else { return false }
      try sealed.write(to: url(name), options: Self.writeOptions)
      return true
    } catch {
      return false
    }
  }

  public func remove(_ name: String) {
    try? FileManager.default.removeItem(at: url(name))
  }

  public func names() -> [String] {
    (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
  }

  public func removeAll() {
    try? FileManager.default.removeItem(at: directory)
  }

  private func url(_ name: String) -> URL {
    let safe = name.unicodeScalars.filter { CharacterSet.alphanumerics.contains($0) || "-_.".unicodeScalars.contains($0) }
    return directory.appendingPathComponent(String(String.UnicodeScalarView(safe)))
  }

  private func prepareDirectory() throws {
    guard !FileManager.default.fileExists(atPath: directory.path) else { return }
    try FileManager.default.createDirectory(
      at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    var folder = directory
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? folder.setResourceValues(values)
  }

  #if os(iOS)
    private static let writeOptions: Data.WritingOptions = [.atomic, .completeFileProtection]
  #else
    private static let writeOptions: Data.WritingOptions = [.atomic]
  #endif
}

/// The sealing key: made on first use, this device only, readable only while unlocked.
enum SealedKey {
  private static let account = "argus.sealed-files"

  static func load(service: String) -> Data? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    var found: CFTypeRef?
    var read = query
    read[kSecReturnData as String] = true
    read[kSecMatchLimit as String] = kSecMatchLimitOne
    let status = SecItemCopyMatching(read as CFDictionary, &found)
    if status == errSecSuccess, let data = found as? Data, data.count == 32 { return data }
    // Locked, or some other refusal: making a new key would orphan every sealed file.
    guard status == errSecItemNotFound else { return nil }

    let key = SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) }
    var add = query
    add[kSecValueData as String] = key
    add[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    return SecItemAdd(add as CFDictionary, nil) == errSecSuccess ? key : nil
  }
}
