import ArgusKit
import UserNotifications
import WidgetKit

/// Opens the sealed payload the desktop sent through the push relay.
///
/// Pushes arrive sealed — the relay that forwards them can't read them — so
/// what Apple delivers is a placeholder plus an encrypted blob. This swaps in
/// the real title, body and quick actions before anything reaches the lock
/// screen. It shares an App Group with the app to read the key the app minted
/// and to update the widgets' snapshot; an extension can't see the app's storage.
final class NotificationService: UNNotificationServiceExtension {
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
    guard let sealed = request.content.userInfo["e"] as? String,
      let pushKey = ArgusSeal.storedPushKey(),
      let opened = ArgusSeal.open(sealed, pushKeyBase64: pushKey)
    else {
      contentHandler(content)
      return
    }

    content.title = opened.title
    content.body = opened.body
    // The category is what draws Approve/Deny, so it only appears once we know
    // this really is a permission prompt.
    if !opened.actions.isEmpty {
      content.categoryIdentifier = NotificationCategory.permission
    }

    // Native code reads these straight off userInfo; there is no
    // expo-notifications `body` indirection to reproduce.
    var info = content.userInfo
    info[NotificationUserInfoKey.agentId] = opened.agentId
    info[NotificationUserInfoKey.sessionId] = opened.sessionId
    info[NotificationUserInfoKey.toolUseId] = opened.toolUseId
    info[NotificationUserInfoKey.label] = opened.title
    info[NotificationUserInfoKey.kind] = opened.kind
    info.removeValue(forKey: "e")
    content.userInfo = info

    // The app may not be running: flag or clear the agent on the widgets now.
    if WidgetSnapshotStore.update({ $0.apply(pushKind: opened.kind, agentId: opened.agentId) }) {
      WidgetCenter.shared.reloadAllTimelines()
    }

    contentHandler(content)
  }

  /// iOS is about to kill us — hand back whatever we have.
  override func serviceExtensionTimeWillExpire() {
    if let contentHandler, let bestAttempt {
      contentHandler(bestAttempt)
    }
  }
}
