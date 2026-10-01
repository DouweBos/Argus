import AppKit
import ArgusCore
import UserNotifications

/// The app's half of platform delegation: the host asks (`platform.request`)
/// for the things only a window can do, and hears back about focus and about
/// banners being clicked (`ui.state`, `ui.notification_action`).
@MainActor
final class PlatformBridge: NSObject, UNUserNotificationCenterDelegate {
  private var backend: LocalBackend?
  private var registeredCategories: Set<UNNotificationCategory> = []
  private var observers: [NSObjectProtocol] = []
  /// Brings the main window forward; set by the app.
  var focusWindow: () -> Void = { NSApp.activate() }

  private nonisolated static let idKey = "argus_notification_id"

  override init() {
    super.init()
    let center = UNUserNotificationCenter.current()
    center.delegate = self
    requestAuthorizationIfNeeded()

    let notifications = NotificationCenter.default
    for (name, foreground) in [
      (NSApplication.didBecomeActiveNotification, true),
      (NSApplication.didResignActiveNotification, false),
    ] {
      observers.append(
        notifications.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
          MainActor.assumeIsolated {
            self?.reportForeground(foreground)
            // macOS only asks while the app is in front; a launch in the
            // background leaves the question pending until the first activation.
            if foreground { self?.requestAuthorizationIfNeeded() }
          }
        })
    }
  }

  private func requestAuthorizationIfNeeded() {
    let center = UNUserNotificationCenter.current()
    center.getNotificationSettings { settings in
      guard settings.authorizationStatus == .notDetermined else { return }
      center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }
  }

  /// A fresh connection: the host knows nothing about our window yet.
  func attach(_ backend: LocalBackend) {
    self.backend = backend
    reportForeground(NSApp.isActive)
  }

  func detach() {
    backend = nil
  }

  private func reportForeground(_ foreground: Bool) {
    guard let backend else { return }
    struct Params: Encodable, Sendable { let foreground: Bool }
    Task {
      _ = try? await backend.request(
        method: "ui.state", Params(foreground: foreground), as: IgnoredResult.self)
    }
  }

  func handle(_ envelope: EventEnvelope) {
    guard envelope.event == "platform.request",
      let request = try? ProtocolCodec.convert(
        envelope.payload, to: ArgusProtocol.PlatformRequest.self)
    else { return }

    #if DEBUG
      // A dev build being driven shouldn't open editors or Finder windows on
      // the machine it runs on; it logs what it would have opened.
      if ProcessInfo.processInfo.environment["ARGUS_DEV_DRY_OPEN"] != nil, request.kind != .notify {
        NSLog("[argus] dry-open %@ %@", request.kind.rawValue, request.path ?? request.url ?? "")
        return
      }
    #endif
    switch request.kind {
    case .notify:
      notify(request)
    case .openExternal:
      if let url = request.url.flatMap(URL.init(string:)) {
        NSWorkspace.shared.open(url)
      }
    case .openPath:
      if let path = request.path {
        NSWorkspace.shared.open(URL(fileURLWithPath: path))
      }
    case .revealInFinder:
      if let path = request.path {
        NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
      }
    case .focusUi:
      focusWindow()
    default:
      // Device popouts arrive with the runtime panel (M3).
      break
    }
  }

  // MARK: Banners

  private func notify(_ request: ArgusProtocol.PlatformRequest) {
    guard let id = request.id else { return }
    let content = UNMutableNotificationContent()
    content.title = request.title ?? "Argus"
    content.body = request.body ?? ""
    content.sound = .default
    content.userInfo = [Self.idKey: id]
    if request.urgency == .critical {
      content.interruptionLevel = .timeSensitive
    }
    let actions = request.actions ?? []
    if !actions.isEmpty {
      content.categoryIdentifier = category(for: actions)
    }
    UNUserNotificationCenter.current().add(
      UNNotificationRequest(identifier: id, content: content, trigger: nil)
    ) { error in
      // Never the content: a denied permission is the usual reason for none.
      NSLog("[argus] banner %@", error.map { "failed: \($0.localizedDescription)" } ?? "shown")
    }
  }

  /// One category per distinct set of buttons; the button index is the action.
  private func category(for labels: [String]) -> String {
    let identifier = "argus.actions." + labels.joined(separator: "|")
    if !registeredCategories.contains(where: { $0.identifier == identifier }) {
      let actions = labels.enumerated().map { index, title in
        UNNotificationAction(identifier: "action.\(index)", title: title)
      }
      registeredCategories.insert(
        UNNotificationCategory(
          identifier: identifier, actions: actions, intentIdentifiers: []))
      UNUserNotificationCenter.current().setNotificationCategories(registeredCategories)
    }
    return identifier
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions {
    // The host only asks for a banner when it decided one is wanted.
    [.banner, .sound]
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
  ) async {
    guard let id = response.notification.request.content.userInfo[Self.idKey] as? String
    else { return }
    let identifier = response.actionIdentifier
    let action = identifier.hasPrefix("action.") ? Int(identifier.dropFirst(7)) : nil
    await answer(id: id, action: action)
  }

  private func answer(id: String, action: Int?) async {
    if action == nil { focusWindow() }
    guard let backend else { return }
    struct Params: Encodable, Sendable {
      let id: String
      let action: Int?

      func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        // The host wants an explicit null for a click on the banner itself.
        try c.encode(action, forKey: .action)
      }

      enum CodingKeys: String, CodingKey { case id, action }
    }
    _ = try? await backend.request(
      method: "ui.notification_action", Params(id: id, action: action),
      as: IgnoredResult.self)
  }
}
