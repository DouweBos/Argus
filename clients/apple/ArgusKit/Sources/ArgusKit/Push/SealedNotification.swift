import CryptoKit
import Foundation

/// A notification the desktop sealed for this device.
///
/// The relay that forwards pushes must never learn what an agent is doing, so
/// the whole notification is encrypted for one device before it leaves the
/// Mac. The key is minted here and handed over the Noise-encrypted gateway.
///
/// Format: `nonce(12) ‖ ciphertext ‖ tag(16)`, base64, AES-256-GCM — matching
/// `packages/host/src/services/remote/push/seal.ts`. Deliberately plain so a
/// Notification Service Extension can open it with CryptoKit, which cannot run
/// Noise.
public struct SealedNotification: Codable, Sendable {
  public var title: String
  public var body: String
  public var kind: String
  public var agentId: String?
  public var sessionId: String?
  public var toolUseId: String?
  public var actions: [RemoteNotificationAction]

  public init(
    title: String, body: String, kind: String,
    agentId: String?, sessionId: String?, toolUseId: String?,
    actions: [RemoteNotificationAction]
  ) {
    self.title = title
    self.body = body
    self.kind = kind
    self.agentId = agentId
    self.sessionId = sessionId
    self.toolUseId = toolUseId
    self.actions = actions
  }
}

public enum ArgusSeal {
  /// The key the app minted, shared with the extension through the App Group —
  /// an extension is a separate process and cannot read the app's Keychain item.
  public static let appGroup = "group.dev.houwert.argus"
  public static let pushKeyDefault = "argus.pushKey"

  public static func storedPushKey(appGroup: String = ArgusSeal.appGroup) -> String? {
    UserDefaults(suiteName: appGroup)?.string(forKey: pushKeyDefault)
  }

  public static func storePushKey(_ base64Key: String, appGroup: String = ArgusSeal.appGroup) {
    UserDefaults(suiteName: appGroup)?.set(base64Key, forKey: pushKeyDefault)
  }

  public static func clearPushKey(appGroup: String = ArgusSeal.appGroup) {
    UserDefaults(suiteName: appGroup)?.removeObject(forKey: pushKeyDefault)
  }

  /// Open a payload sealed by the desktop, or nil if we can't.
  ///
  /// Every failure is silent on purpose: the caller leaves the placeholder
  /// alert in place, and a vague notification beats both a missing one and a
  /// lock screen full of ciphertext.
  public static func open(_ sealed: String, pushKeyBase64: String) -> SealedNotification? {
    guard let key = ArgusBase64.decode(pushKeyBase64), key.count == 32,
      let blob = ArgusBase64.decode(sealed),
      // 12-byte nonce + 16-byte tag, so anything shorter can't be one of ours.
      blob.count > 28,
      let nonce = try? AES.GCM.Nonce(data: blob.prefix(12))
    else { return nil }

    let box = try? AES.GCM.SealedBox(
      nonce: nonce,
      ciphertext: blob.dropFirst(12).dropLast(16),
      tag: blob.suffix(16)
    )
    guard let box,
      let plaintext = try? AES.GCM.open(box, using: SymmetricKey(data: key)),
      let opened = try? JSONDecoder().decode(SealedNotification.self, from: plaintext)
    else { return nil }
    return opened
  }

  /// Seal a notification. Only used by tests here — the desktop does the real
  /// sealing — but it keeps the format honest in both directions.
  public static func seal(
    _ notification: SealedNotification, pushKeyBase64: String, nonce: Data
  ) throws -> String {
    guard let key = ArgusBase64.decode(pushKeyBase64), key.count == 32 else {
      throw CryptoKitError.incorrectKeySize
    }
    let box = try AES.GCM.seal(
      JSONEncoder().encode(notification),
      using: SymmetricKey(data: key),
      nonce: try AES.GCM.Nonce(data: nonce)
    )
    return ArgusBase64.encode(nonce + box.ciphertext + box.tag)
  }

  /// The opaque collapse key the relay sees. Mirrors the desktop's
  /// `collapseId`: HMAC so the relay learns nothing from the grouping itself.
  public static func collapseId(pushKeyBase64: String, subject: String) -> String? {
    guard let key = ArgusBase64.decode(pushKeyBase64) else { return nil }
    let mac = HMAC<SHA256>.authenticationCode(
      for: Data(subject.utf8), using: SymmetricKey(data: key))
    return String(ArgusBase64.encodeURL(Data(mac)).prefix(22))
  }
}
