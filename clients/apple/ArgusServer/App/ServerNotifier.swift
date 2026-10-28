import ArgusCore
import Foundation
@preconcurrency import UserNotifications

/// Banners for what needs someone at the server while the menu is closed: a
/// device's pairing code to compare, a device waiting to join the account.
/// Clicking one opens what it's about. Never carries the code itself.
@MainActor
final class ServerNotifier: NSObject, UNUserNotificationCenterDelegate {
  enum Target: Equatable {
    case pairing
    case joinRequest(String)
  }

  var onOpen: ((Target) -> Void)?
  private var authorized = false
  private var center: UNUserNotificationCenter? {
    // Unit tests run without a bundle that can post.
    Bundle.main.bundleIdentifier == nil ? nil : UNUserNotificationCenter.current()
  }

  func install() {
    center?.delegate = self
  }

  func pairingCode(_ sas: String) {
    post(
      id: "pairing", title: "A device wants to pair",
      body: "Compare the 6-digit code it shows with Argus Server's, then approve or reject it.",
      target: "pairing")
  }

  func joinRequest(_ request: ArgusProtocol.AccountJoinRequest) {
    post(
      id: "join-\(request.requestId)", title: "\(request.subjectName) wants to join your account",
      body: "Review it to compare a 6-digit code on both screens.", target: "join:\(request.requestId)")
  }

  private func post(id: String, title: String, body: String, target: String) {
    guard let center else { return }
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.userInfo = ["target": target]
    let request = UNNotificationRequest(identifier: id, content: content, trigger: nil)
    Task {
      if !authorized {
        authorized = (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
      }
      guard authorized else { return }
      try? await center.add(request)
    }
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
  ) async {
    let target = response.notification.request.content.userInfo["target"] as? String ?? ""
    await MainActor.run {
      if target == "pairing" {
        onOpen?(.pairing)
      } else if target.hasPrefix("join:") {
        onOpen?(.joinRequest(String(target.dropFirst(5))))
      }
    }
  }

  nonisolated func userNotificationCenter(
    _ center: UNUserNotificationCenter, willPresent notification: UNNotification
  ) async -> UNNotificationPresentationOptions {
    [.banner, .sound]
  }
}
