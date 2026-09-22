import ArgusKit
import Foundation
import UIKit

/// APNs registration and the two relay keys this device mints.
enum PushTokens {
  private static let relayKeysAccount = "argus.push.keys"

  struct RelayKeys {
    /// Seals the notification. 32 bytes, base64.
    var pushKey: String
    /// Authenticates senders to the relay. 32 bytes, base64.
    var authKey: String
  }

  static var environment: String {
    #if DEBUG
      // Debug builds get sandbox tokens; the relay corrects a wrong guess, so
      // this only ever costs one wasted round trip.
      "sandbox"
    #else
      "production"
    #endif
  }

  @MainActor private static var tokenContinuation: CheckedContinuation<String?, Never>?
  @MainActor private static var cachedToken: String?

  /// Called by the app delegate once APNs answers.
  @MainActor
  static func received(token: Data?) {
    cachedToken = token?.map { String(format: "%02x", $0) }.joined()
    tokenContinuation?.resume(returning: cachedToken)
    tokenContinuation = nil
  }

  @MainActor
  static func authorizationStatus() async -> UNAuthorizationStatus {
    await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
  }

  @MainActor
  static func isAuthorized() async -> Bool {
    let status = await UNUserNotificationCenter.current().notificationSettings()
      .authorizationStatus
    return status == .authorized || status == .provisional
  }

  @MainActor
  static func deviceToken() async -> String? {
    if let cachedToken { return cachedToken }
    guard await isAuthorized() else { return nil }

    // A second caller arriving mid-flight must not strand the first by
    // replacing its continuation, and must not resume it twice either.
    if let pending = tokenContinuation {
      tokenContinuation = nil
      pending.resume(returning: nil)
    }

    UIApplication.shared.registerForRemoteNotifications()
    return await withCheckedContinuation { continuation in
      tokenContinuation = continuation
      // A simulator never answers; don't leave the caller hanging on it.
      Task {
        try? await Task.sleep(for: .seconds(5))
        guard let pending = tokenContinuation else { return }
        tokenContinuation = nil
        pending.resume(returning: cachedToken)
      }
    }
  }

  /// Minted once and kept. The sealing key is copied into the shared App Group
  /// every time, because the notification extension is a separate process and
  /// that container is the only place it can read from.
  static func relayKeys() -> RelayKeys {
    if let stored = KeychainBlob.read(account: relayKeysAccount),
      let decoded = try? JSONDecoder().decode([String: String].self, from: stored),
      let pushKey = decoded["pushKey"], let authKey = decoded["authKey"]
    {
      ArgusSeal.storePushKey(pushKey)
      return RelayKeys(pushKey: pushKey, authKey: authKey)
    }
    let keys = RelayKeys(pushKey: randomKey(), authKey: randomKey())
    if let data = try? JSONEncoder().encode(["pushKey": keys.pushKey, "authKey": keys.authKey]) {
      KeychainBlob.write(data, account: relayKeysAccount)
    }
    ArgusSeal.storePushKey(keys.pushKey)
    return keys
  }

  static func forgetRelayKeys() {
    KeychainBlob.delete(account: relayKeysAccount)
    ArgusSeal.clearPushKey()
  }

  private static func randomKey() -> String {
    var bytes = [UInt8](repeating: 0, count: 32)
    _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    return ArgusBase64.encode(Data(bytes))
  }

  enum RelayResult { case ok, conflict, failed }

  static func registerWithRelay(relayURL: String, token: String, authKey: String) async
    -> RelayResult
  {
    var trimmed = relayURL
    while trimmed.hasSuffix("/") { trimmed.removeLast() }
    guard let url = URL(string: "\(trimmed)/register") else { return .failed }

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.httpBody = try? JSONSerialization.data(withJSONObject: [
      "token": token,
      "service": "apns",
      "auth_key": authKey,
      "ts": Int(Date().timeIntervalSince1970 * 1000),
    ])

    guard let (_, response) = try? await URLSession.shared.data(for: request),
      let http = response as? HTTPURLResponse
    else { return .failed }
    if (200..<300).contains(http.statusCode) { return .ok }
    // A previous install claimed this token and we no longer hold its key.
    // The relay expires registrations, so this resolves itself.
    return http.statusCode == 409 ? .conflict : .failed
  }
}

/// Small Keychain blob store for secrets that aren't the pairing set.
enum KeychainBlob {
  private static let service = "dev.houwert.argus"

  private static func query(_ account: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
  }

  static func read(account: String) -> Data? {
    var q = query(account)
    q[kSecReturnData as String] = true
    q[kSecMatchLimit as String] = kSecMatchLimitOne
    var item: CFTypeRef?
    guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess else { return nil }
    return item as? Data
  }

  static func write(_ data: Data, account: String) {
    let attributes: [String: Any] = [
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    if SecItemUpdate(query(account) as CFDictionary, attributes as CFDictionary)
      == errSecItemNotFound
    {
      SecItemAdd(query(account).merging(attributes) { $1 } as CFDictionary, nil)
    }
  }

  static func delete(account: String) {
    SecItemDelete(query(account) as CFDictionary)
  }
}
