import ArgusKit
import SwiftUI
import UserNotifications

/// Turns a tapped notification into a screen, and an Approve/Deny button into
/// an answer.
///
/// Registered before the biometric gate is passed, because a background tap
/// must never be dropped. A tap that lands while the app is still locked is
/// parked and replayed once the navigator exists.
@MainActor
final class NotificationRouter: NSObject {
  static let shared = NotificationRouter()

  private weak var app: AppStore?
  private weak var router: Router?
  private var pendingOpen: (agentId: String, label: String)?

  func configure(app: AppStore, router: Router) {
    self.app = app
    self.router = router
    UNUserNotificationCenter.current().delegate = self
  }

  /// iOS draws a notification's buttons from a category the app registers up
  /// front; the desktop only names it. Both stay in the background so
  /// answering a prompt never yanks you into the app.
  func registerCategories() async {
    let approve = UNNotificationAction(
      identifier: NotificationAction.approve, title: "Approve", options: [])
    let deny = UNNotificationAction(
      identifier: NotificationAction.deny, title: "Deny", options: [.destructive])
    let category = UNNotificationCategory(
      identifier: NotificationCategory.permission,
      actions: [approve, deny],
      intentIdentifiers: [],
      options: [])
    UNUserNotificationCenter.current().setNotificationCategories([category])
  }

  func requestAuthorization() async -> Bool {
    (try? await UNUserNotificationCenter.current().requestAuthorization(
      options: [.alert, .sound, .badge])) ?? false
  }

  func authorizationStatus() async -> UNAuthorizationStatus {
    await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
  }

  /// Called once the gate is passed, for a tap that arrived while locked.
  func replayPendingOpen() {
    guard let pending = pendingOpen else { return }
    pendingOpen = nil
    open(agentId: pending.agentId, label: pending.label)
  }

  private func open(agentId: String, label: String) {
    guard let app, let router else {
      pendingOpen = (agentId, label)
      return
    }
    // Repeated alerts for the same agent shouldn't stack copies of its screen.
    guard !router.isShowingAgent(agentId) else { return }

    Task {
      // The alert may be from a computer we aren't currently connected to —
      // switch to the one that owns the agent before opening it.
      if let hostId = app.host(forAgent: agentId), hostId != app.activeHostId {
        await app.selectHost(hostId)
      }
      router.push(.agent(id: agentId, label: label))
    }
  }
}

extension NotificationRouter: UNUserNotificationCenterDelegate {
  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse
  ) async {
    let info = response.notification.request.content.userInfo
    let agentId = info[NotificationUserInfoKey.agentId] as? String
    let toolUseId = info[NotificationUserInfoKey.toolUseId] as? String
    let label = info[NotificationUserInfoKey.label] as? String ?? "Agent"
    let action = response.actionIdentifier

    await MainActor.run {
      guard let agentId else { return }
      if action == NotificationAction.approve || action == NotificationAction.deny {
        guard let toolUseId else { return }
        let decision = action == NotificationAction.approve ? "allow" : "deny"
        // Persisted first, then sent — an answer given on a train has to
        // survive until there is a connection to send it on.
        if let app = self.app {
          app.queueOfflineDecision(
            agentId: agentId, toolUseId: toolUseId, decision: decision)
          Task { await app.respond(
            agentId: agentId, toolUseId: toolUseId, decision: decision) }
        }
        return
      }
      self.open(agentId: agentId, label: label)
    }
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions {
    [.banner, .list]
  }
}

/// APNs token plumbing — the one thing SwiftUI has no hook for.
final class AppDelegate: NSObject, UIApplicationDelegate {
  func application(
    _ application: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    Task { @MainActor in PushTokens.received(token: deviceToken) }
  }

  func application(
    _ application: UIApplication,
    didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {
    Task { @MainActor in PushTokens.received(token: nil) }
  }
}
