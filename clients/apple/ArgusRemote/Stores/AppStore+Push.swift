import ArgusCore
import Foundation
import UIKit
import UserNotifications

/// Background-push status, purely for what the settings screen tells the user.
enum PushState: String, Sendable {
  case conflict, off, registered, unavailable, unconfigured, unsupported
  /// The computer rejected the registration itself.
  case registrationRefused
  /// Notifications were never allowed, so there is no token to register.
  case denied
  /// Allowed, but APNs returned nothing — no entitlement, or a simulator.
  case noToken
  /// The relay refused the registration, so the desktop can't reach us.
  case relayFailed

  var explanation: String {
    switch self {
    case .registered:
      "Registered — your computer can wake this phone."
    case .conflict:
      """
      The push relay still has this device claimed by an older install and is \
      running a version that won't add a second key. Update the relay, or wait \
      for the old claim to lapse.
      """
    case .unconfigured:
      "Registered, but Argus on your computer has no Apple push credentials yet."
    case .unavailable:
      "Unavailable on this build — needs notification permission and a real device."
    case .unsupported:
      "The computer you're connected to is running an older Argus. Update it to enable background push."
    case .off:
      "Off — you'll only see alerts while the app is connected."
    case .denied:
      "Notifications aren't allowed for Argus. Enable them in iOS Settings."
    case .noToken:
      "Apple didn't issue a push token for this install. A simulator never does; on a device this usually means the push entitlement is missing."
    case .relayFailed:
      "Couldn't reach the Argus push relay to register this device."
    case .registrationRefused:
      "Your computer refused this device's push registration."
    }
  }
}

enum UIDeviceName {
  @MainActor
  static var current: String {
    let name = UIDevice.current.name.trimmingCharacters(in: .whitespaces)
    return name.isEmpty ? "iPhone" : name
  }
}

extension AppStore {

  // MARK: Registration

  func setPushEnabled(_ enabled: Bool) async {
    pushEnabled = enabled
    preferences.set(enabled ? "on" : "off", for: PreferenceKey.pushEnabled)
    if let backend = host.backend {
      if enabled {
        await registerPush(backend)
      } else {
        _ = try? await backend.request(
          .deviceUnregisterPush, EmptyParams(), as: IgnoredResult.self)
        pushState = .off
      }
    }
    if enabled {
      await registerAccountPush()
    } else {
      await account.setPushToken(nil)
    }
  }

  /// This install's token and push key, if push is on and already allowed.
  /// Never prompts: that happens on the first connection.
  func accountPushToken() async -> AccountPushToken? {
    guard pushEnabled, await PushTokens.isAuthorized(),
      let token = await PushTokens.deviceToken()
    else { return nil }
    return AccountPushToken(
      token: token, environment: PushTokens.environment, pushKey: PushTokens.relayKeys().pushKey)
  }

  /// Register with the account, so every computer on it can wake this phone —
  /// including ones it never opened. Re-registered by the store as hosts change.
  func registerAccountPush() async {
    guard let token = await accountPushToken() else { return }
    await account.setPushToken(token)
  }

  func setDeviceName(_ name: String) async {
    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    deviceName = trimmed
    preferences.set(trimmed, for: PreferenceKey.deviceName)
    struct Params: Encodable { let name: String }
    _ = try? await host.backend?.request(
      .deviceRename, Params(name: trimmed), as: IgnoredResult.self)
  }

  /// Hand this device's push token and its two keys to the computer.
  ///
  /// The relay holds the Apple credentials but is never trusted with content:
  /// one key seals the notification, the other proves to the relay which
  /// computers may push here. Both travel over the already-encrypted gateway.
  func registerPush(_ backend: any HostBackend) async {
    guard pushEnabled else {
      pushState = .off
      return
    }
    // Being woken while away is the whole point of pairing, so ask on the
    // first connection instead of waiting for a trip to Settings. Only ever
    // asked once — iOS ignores the call after the first answer.
    if await PushTokens.authorizationStatus() == .notDetermined {
      _ = await NotificationRouter.shared.requestAuthorization()
    }
    guard await PushTokens.isAuthorized() else {
      pushState = .denied
      return
    }
    guard let token = await PushTokens.deviceToken() else {
      pushState = .noToken
      return
    }
    await account.setPushToken(
      AccountPushToken(
        token: token, environment: PushTokens.environment, pushKey: PushTokens.relayKeys().pushKey))
    // An account computer reaches this phone through the account; a per-host
    // registration is only for QR pairings (and as a fallback).
    if identity?.isAccountHost == true, account.pushRegistered {
      preferences.set(token, for: PreferenceKey.pushToken)
      pushState = .registered
      return
    }

    struct PushInfo: Decodable {
      let configured: Bool
      let enabled: Bool
      let relay_url: String?
    }
    let info: PushInfo
    do {
      info = try await backend.request(.devicePushInfo, EmptyParams(), as: PushInfo.self)
    } catch {
      // An older desktop doesn't know the method at all.
      pushState = .unsupported
      return
    }
    guard info.configured else {
      pushState = .unconfigured
      return
    }

    let keys = PushTokens.relayKeys()
    // The relay must know the auth key before the desktop pushes, or it has
    // nothing to verify the signature against.
    if let relayURL = info.relay_url {
      switch await PushTokens.registerWithRelay(
        relayURL: relayURL, token: token, authKey: keys.authKey)
      {
      case .conflict:
        pushState = .conflict
        return
      case .failed:
        pushState = .relayFailed
        return
      case .ok:
        break
      }
    }

    struct Params: Encodable {
      let service: String
      let token: String
      let environment: String
      let push_key: String
      let auth_key: String
    }
    do {
      try await backend.request(
        .deviceRegisterPush,
        Params(
          service: "apns", token: token,
          environment: PushTokens.environment,
          push_key: keys.pushKey, auth_key: keys.authKey),
        as: IgnoredResult.self)
      preferences.set(token, for: PreferenceKey.pushToken)
      pushState = .registered
    } catch {
      pushState = .registrationRefused
    }
  }

  // MARK: Offline decisions

  func queueOfflineDecision(agentId: String, toolUseId: String, decision: String) {
    pendingDecisions.queue(
      PendingDecision(
        agentId: agentId, hostId: activeHostId ?? agentHosts.host(forAgent: agentId),
        toolUseId: toolUseId, decision: decision,
        at: Date().timeIntervalSince1970 * 1000))
  }

  /// Replay answers given from a notification while offline.
  ///
  /// The gateway only accepts an answer to a prompt it forwarded to *this*
  /// connection, and it re-forwards pending ones on subscribe — hence the
  /// subscribe, the retries, and the unsubscribe afterwards.
  func flushPendingDecisions(_ backend: any HostBackend) async {
    let queued = pendingDecisions.read(hostId: activeHostId)
    for decision in queued {
      await backend.subscribe(agentId: decision.agentId, on: true)
      defer { Task { await backend.subscribe(agentId: decision.agentId, on: false) } }

      struct Params: Encodable {
        let agent_id: String
        let tool_use_id: String
        let decision: String
      }
      for attempt in 0..<5 {
        if attempt > 0 { try? await Task.sleep(for: .milliseconds(400)) }
        let sent = (try? await backend.request(
          .permissionRespond,
          Params(
            agent_id: decision.agentId, tool_use_id: decision.toolUseId,
            decision: decision.decision),
          as: IgnoredResult.self)) != nil
        if sent { break }
      }
      // Cleared either way: a stale answer is worse than a missing one.
      pendingDecisions.clear(key: decision.key)
    }
  }
}

/// Posts a gateway notification locally while the app is backgrounded.
enum NotificationPresenter {
  @MainActor
  static func present(_ notification: RemoteNotification) {
    // Suppressed while the user is looking at the app, matching the desktop.
    guard UIApplication.shared.applicationState != .active else { return }

    let content = UNMutableNotificationContent()
    content.title = notification.title
    content.body = notification.body
    if !notification.actions.isEmpty {
      content.categoryIdentifier = NotificationCategory.permission
    }
    content.userInfo = [
      NotificationUserInfoKey.agentId: notification.agentId as Any,
      NotificationUserInfoKey.toolUseId: notification.toolUseId as Any,
      NotificationUserInfoKey.label: notification.title,
      NotificationUserInfoKey.kind: notification.kind.rawValue,
    ]

    // The same collapse key the pushed version uses, so an in-band alert and a
    // pushed one about the same thing replace each other instead of stacking.
    let identifier = notification.collapseIdentifier ?? UUID().uuidString
    UNUserNotificationCenter.current().add(
      UNNotificationRequest(identifier: identifier, content: content, trigger: nil))
  }
}
