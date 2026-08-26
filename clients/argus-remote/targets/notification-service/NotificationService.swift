import UserNotifications

/// Opens the sealed payload the desktop sent through the push relay.
///
/// Wire format, matching `seal.ts` on the desktop: base64 of
/// `nonce(12) ‖ ciphertext ‖ tag(16)`, AES-256-GCM, under a 32-byte key the
/// app minted and shared with its paired desktop over the encrypted gateway.
/// The relay only ever handles the sealed blob.
class NotificationService: UNNotificationServiceExtension {
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var bestAttempt: UNMutableNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    let content = request.content.mutableCopy() as? UNMutableNotificationContent
    bestAttempt = content

    guard let content else {
      contentHandler(request.content)
      return
    }

    // Anything unexpected leaves the placeholder in place: a vague alert beats
    // a missing one, and beats showing ciphertext.
    guard
      let sealed = request.content.userInfo["e"] as? String,
      let opened = ArgusSeal.open(sealed)
    else {
      contentHandler(content)
      return
    }

    content.title = opened.title
    content.body = opened.body
    // The category is what draws Approve/Deny, so it only appears once we know
    // this really is a permission prompt.
    if !opened.actions.isEmpty {
      content.categoryIdentifier = "argus.permission"
    }

    // expo-notifications reads a *remote* notification's `content.data` from
    // userInfo["body"], not the top level — flat keys here never reach JS.
    var routing: [String: Any] = ["label": opened.title, "kind": opened.kind]
    routing["agentId"] = opened.agentId
    routing["sessionId"] = opened.sessionId
    routing["toolUseId"] = opened.toolUseId

    var info = content.userInfo
    info["body"] = routing
    info.removeValue(forKey: "e")
    content.userInfo = info

    contentHandler(content)
  }

  /// iOS is about to kill us — hand back whatever we have.
  override func serviceExtensionTimeWillExpire() {
    if let contentHandler, let bestAttempt {
      contentHandler(bestAttempt)
    }
  }
}
