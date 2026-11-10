import ArgusCore
import SwiftUI
import UserNotifications

/// Turns a tapped notification into a screen, an Approve/Deny button into an
/// answer, and a Handoff or an `argus://` link into the screen it names.
///
/// Registered before the biometric gate is passed, because a background tap
/// must never be dropped. A tap that lands while the app is still locked is
/// parked and replayed once the navigator exists.
@MainActor
final class NotificationRouter: NSObject {
  static let shared = NotificationRouter()

  private(set) weak var app: AppStore?
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
    case .link(let location, let via): open(location, via: via)
    }
  }

  /// Continue what the Mac had on screen, read as the route it names.
  func open(_ handoff: Handoff) {
    guard ready, let app else {
      pendingOpen = .handoff(handoff)
      return
    }
    guard let host = app.hosts.first(where: { handoff.names(desktopKey: $0.desktopPubB64) })
    else {
      app.host.showError("That computer isn't paired with this phone.")
      return
    }
    let route = ArgusRoute.session(id: handoff.sessionId, agentId: handoff.agentId)
    let hints = RouteHints(
      agentLabel: handoff.label, repoRoot: handoff.repoRoot, projectName: handoff.projectName)
    open(route, on: host.deviceId, hints: hints, via: .handoff)
  }

  /// An `argus://` link, a Spotlight result or an Open intent. `?host=` picks the
  /// paired computer it names; none, or one this phone doesn't know, reads from the current one.
  func open(_ location: ArgusLocation, via: TelemetryEvent.LinkSource = .link) {
    guard ready, let app else {
      pendingOpen = .link(location, via: via)
      return
    }
    guard !app.hosts.isEmpty else {
      app.host.showError("Pair a computer before opening Argus links.")
      return
    }
    let hostId = location.host.flatMap { id in app.hosts.first { $0.deviceId == id }?.deviceId }
    open(location.route, on: hostId, hints: RouteHints(), via: via)
  }

  private func open(_ route: ArgusRoute, on hostId: String?, hints: RouteHints, via: TelemetryEvent.LinkSource) {
    guard let app, let router else { return }
    if let agentId = route.agentId, router.showAgentIfOpen(agentId) { return }
    Task {
      if let hostId, hostId != app.activeHostId { await app.selectHost(hostId) }
      let destination = await PhoneDestination.resolve(route, host: app.host, hints: hints)
      Telemetry.capture(.linkOpened(screen: route.pattern, via: via, fallback: destination.isFallback))
      router.open(destination)
    }
  }

  private func open(agentId: String, label: String) {
    guard ready, let app, let router else {
      pendingOpen = .agent(id: agentId, label: label)
      return
    }
    // Repeated alerts for the same agent shouldn't stack copies of its screen.
    guard !router.showAgentIfOpen(agentId) else { return }

    Task {
      // The alert may be from a computer we aren't currently connected to —
      // switch to the one that owns the agent before opening it.
      if let hostId = app.hostId(forAgent: agentId), hostId != app.activeHostId {
        await app.selectHost(hostId)
      }
      // `open` rather than `push`: an agent belongs under Home, and a tap
      // should land there whatever section was last on screen.
      router.open(.agent(id: agentId, label: label), in: .home)
    }
  }
}

/// A destination that arrived before there was anywhere to put it.
private enum PendingOpen {
  case agent(id: String, label: String)
  case handoff(Handoff)
  case link(ArgusLocation, via: TelemetryEvent.LinkSource)
}

/// UIKit asserts its completion handlers run on the main thread; the `async`
/// delegate variants call them from the cooperative pool and abort the app.
private struct MainThreadCompletion<T>: @unchecked Sendable {
  let call: (T) -> Void
}

extension NotificationRouter: UNUserNotificationCenterDelegate {
  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    let info = response.notification.request.content.userInfo
    let agentId = info[NotificationUserInfoKey.agentId] as? String
    let toolUseId = info[NotificationUserInfoKey.toolUseId] as? String
    let label = info[NotificationUserInfoKey.label] as? String ?? "Agent"
    let action = response.actionIdentifier
    let completion = MainThreadCompletion<Void> { _ in completionHandler() }

    Task { @MainActor in
      handle(agentId: agentId, toolUseId: toolUseId, label: label, action: action)
      completion.call(())
    }
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler:
      @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    let completion = MainThreadCompletion(call: completionHandler)
    Task { @MainActor in completion.call([.banner, .list]) }
  }

  private func handle(agentId: String?, toolUseId: String?, label: String, action: String) {
    guard let agentId else { return }
    if action == NotificationAction.approve || action == NotificationAction.deny {
      guard let toolUseId else { return }
      let decision = action == NotificationAction.approve ? "allow" : "deny"
      // Persisted first, then sent — an answer given on a train has to
      // survive until there is a connection to send it on.
      if let app {
        app.queueOfflineDecision(
          agentId: agentId, toolUseId: toolUseId, decision: decision)
        Task { await app.host.respond(
          agentId: agentId, toolUseId: toolUseId, decision: decision,
          fromNotification: true) }
      }
      return
    }
    open(agentId: agentId, label: label)
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
    MainActor.assumeIsolated {
      NotificationRouter.shared.attach()
      Telemetry.start()
    }
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

  /// The account service's wake-ups; sealed alerts go through the extension instead.
  func application(
    _ application: UIApplication,
    didReceiveRemoteNotification userInfo: [AnyHashable: Any],
    fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
  ) {
    guard let reason = AccountWake.reason(userInfo) else {
      completionHandler(.noData)
      return
    }
    let completion = MainThreadCompletion(call: completionHandler)
    Task { @MainActor in
      completion.call(await AccountWake.handle(reason, app: NotificationRouter.shared.app))
    }
  }
}
