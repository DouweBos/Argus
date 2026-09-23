import ArgusKit
import SwiftUI
import UserNotifications

/// Turns a tapped notification into a screen, an Approve/Deny button into an
/// answer, and a Handoff from the desktop into the same screen the Mac had
/// open.
///
/// Registered before the biometric gate is passed, because a background tap
/// must never be dropped. A tap that lands while the app is still locked is
/// parked and replayed once the navigator exists.
@MainActor
final class NotificationRouter: NSObject {
  static let shared = NotificationRouter()

  private weak var app: AppStore?
  private weak var router: Router?
  private var pendingOpen: PendingOpen?
  /// Nothing can be opened until the gate is passed and the stack exists.
  private var ready = false

  /// Claim the delegate during launch.
  ///
  /// iOS hands over a launch tap only if a delegate is already set by the time
  /// `didFinishLaunching` returns; claiming it from a SwiftUI `.task` is too
  /// late and the tap is dropped. The response is parked until `configure`.
  func attach() {
    UNUserNotificationCenter.current().delegate = self
  }

  func configure(app: AppStore, router: Router) {
    self.app = app
    self.router = router
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
  func unlocked() {
    ready = true
    guard let pending = pendingOpen else { return }
    pendingOpen = nil
    switch pending {
    case .agent(let id, let label): open(agentId: id, label: label)
    case .handoff(let handoff): open(handoff)
    }
  }

  /// Continue what the Mac had on screen. The desktop is session-centric and
  /// this app agent-centric, so an agent is preferred and the project is the
  /// fallback for a session with nothing running in it.
  func open(_ handoff: Handoff) {
    guard ready, let app, let router else {
      pendingOpen = .handoff(handoff)
      return
    }
    guard let host = app.hosts.first(where: { handoff.names(desktopKey: $0.desktopPubB64) })
    else {
      app.lastError = "That computer isn't paired with this phone."
      return
    }
    if let agentId = handoff.agentId, router.isShowingAgent(agentId) { return }

    Task {
      if host.deviceId != app.activeHostId { await app.selectHost(host.deviceId) }
      if let agentId = handoff.agentId {
        router.open(
          .agent(id: agentId, label: handoff.label ?? "Agent"), in: .projects)
      } else if let repoRoot = handoff.repoRoot {
        router.open(
          .project(repoRoot: repoRoot, name: handoff.projectName ?? "Project"),
          in: .projects)
      }
    }
  }

  private func open(agentId: String, label: String) {
    guard ready, let app, let router else {
      pendingOpen = .agent(id: agentId, label: label)
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
      // `open` rather than `push`: an agent belongs under Projects, and a tap
      // should land there whatever section was last on screen.
      router.open(.agent(id: agentId, label: label), in: .projects)
    }
  }
}

/// A destination that arrived before there was anywhere to put it.
private enum PendingOpen {
  case agent(id: String, label: String)
  case handoff(Handoff)
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

/// APNs token plumbing and the launch-time notification delegate — the things
/// SwiftUI has no hook for.
final class AppDelegate: NSObject, UIApplicationDelegate {
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions:
      [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    MainActor.assumeIsolated { NotificationRouter.shared.attach() }
    return true
  }

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
