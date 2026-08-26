import CryptoKit
import Foundation

/// The App Group the app and this extension share. The app writes the push key
/// there because an extension runs in its own process and cannot read the
/// app's storage.
private let appGroup = "group.dev.houwert.argus.remote"
private let pushKeyDefault = "argus.pushKey"

struct SealedNotification {
  let title: String
  let body: String
  let kind: String
  let agentId: String?
  let sessionId: String?
  let toolUseId: String?
  let actions: [[String: String]]
}

enum ArgusSeal {
  /// Decrypt a payload sealed by the desktop, or nil if we can't.
  static func open(_ sealed: String) -> SealedNotification? {
    guard
      let keyBase64 = UserDefaults(suiteName: appGroup)?.string(forKey: pushKeyDefault),
      let keyData = Data(base64Encoded: keyBase64),
      keyData.count == 32,
      let blob = Data(base64Encoded: sealed),
      // 12-byte nonce + 16-byte tag, so anything shorter can't be one of ours.
      blob.count > 28
    else {
      return nil
    }

    let nonceData = blob.prefix(12)
    let tag = blob.suffix(16)
    let ciphertext = blob.dropFirst(12).dropLast(16)

    guard
      let nonce = try? AES.GCM.Nonce(data: nonceData),
      let box = try? AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag),
      let plaintext = try? AES.GCM.open(box, using: SymmetricKey(data: keyData)),
      let json = try? JSONSerialization.jsonObject(with: plaintext) as? [String: Any],
      let title = json["title"] as? String,
      let body = json["body"] as? String
    else {
      return nil
    }

    return SealedNotification(
      title: title,
      body: body,
      kind: json["kind"] as? String ?? "push",
      agentId: json["agentId"] as? String,
      sessionId: json["sessionId"] as? String,
      toolUseId: json["toolUseId"] as? String,
      actions: json["actions"] as? [[String: String]] ?? []
    )
  }
}
