import ArgusCore
import Foundation
import MetricKit
import PostHog
import StoreKit
import UIKit

/// How much this install shares. `presence` is the floor and the default —
/// the desktop's model, mirrored so the two clients answer the same question
/// the same way.
enum TelemetryMode: String, Sendable {
  case presence
  case full
}

/// The only file that imports `PostHog`. Everything above it deals in typed
/// events and plain strings, which keeps the SDK's types off the app's
/// `Sendable`-checked boundaries.
///
/// Privacy rules, identical to `packages/host/src/services/telemetry`:
///
/// - Distinct id is a random UUID stored in `UserDefaults`; it is never linked
///   to an account, and `identify` is never called.
/// - No autocapture, no screen swizzling, no session replay, no lifecycle
///   events — everything sent is sent from here, explicitly.
/// - `presence` sends exactly one `$pageview` heartbeat per launch and nothing
///   else. `full` unlocks the catalog, `$screen`, and `$exception`.
/// - Off entirely when `POSTHOG_KEY` is empty, which is what a checkout
///   without a local xcconfig gets.
@MainActor
enum Telemetry {
  private static var client: PostHogSDK?
  private static var mode: TelemetryMode = .presence
  private static var distinctId = ""
  private static var isTestFlight = false
  private static let crashes = CrashDiagnostics()

  static var currentMode: TelemetryMode { mode }

  /// True once the user has answered the consent sheet, so it is only ever
  /// shown on a fresh install.
  static var hasAnsweredConsent: Bool {
    preferences.string(PreferenceKey.telemetryConsentSeen) == "yes"
  }

  private static let preferences = Preferences()

  static func start() {
    guard client == nil else { return }
    distinctId = anonymousId()
    mode = TelemetryMode(rawValue: preferences.string(PreferenceKey.telemetryMode) ?? "")
      ?? .presence

    guard let key = infoString("POSTHOG_KEY"), !key.isEmpty else { return }

    let config = PostHogConfig(
      projectToken: key, host: infoString("POSTHOG_HOST") ?? "https://eu.i.posthog.com")
    // Nothing is captured that this file didn't ask for.
    config.captureApplicationLifecycleEvents = false
    config.captureScreenViews = false
    config.captureElementInteractions = false
    config.sessionReplay = false
    config.enableSwizzling = false
    config.preloadFeatureFlags = false
    config.personProfiles = .identifiedOnly
    // The iPhone app is low volume — send each event as it happens rather than
    // losing a batch when the phone is locked mid-flush.
    config.flushAt = 1
    config.getAnonymousId = { fallback in UUID(uuidString: distinctId) ?? fallback }

    let sdk = PostHogSDK.shared
    sdk.setup(config)
    client = sdk

    captureHeartbeat()
    Task { isTestFlight = await sandboxed() }
    installExceptionHandler()
    crashes.subscribe()
    capture(.launched)
  }

  static func setMode(_ next: TelemetryMode) {
    preferences.set("yes", for: PreferenceKey.telemetryConsentSeen)
    preferences.set(next.rawValue, for: PreferenceKey.telemetryMode)
    guard next != mode else { return }

    if next == .full {
      mode = .full
      capture(.telemetryEnabled)
      capture(.launched)

      return
    }
    // Record the downgrade before the gate closes on it.
    capture(.telemetryDisabled)
    mode = .presence
    flush()
  }

  static func capture(_ event: TelemetryEvent) {
    guard let client, mode == .full else { return }
    client.capture(event.name, properties: baseProps().merging(event.properties) { _, new in new })
  }

  /// A route pattern, never a title or an identifier — see
  /// `Route.pattern`.
  static func screen(_ route: Route) {
    guard let client, mode == .full else { return }
    client.capture(
      "$screen", properties: baseProps().merging(["$screen_name": route.pattern]) { _, new in new })
  }

  static func captureException(
    _ error: Error, source: String, extra: [String: Any] = [:]
  ) {
    // Stack traces can leak paths even after scrubbing, so they stay behind
    // the full-mode gate.
    guard mode == .full else { return }
    let described = HostStore.describe(error)
    captureException(
      type: String(describing: type(of: error)), message: described, source: source, extra: extra)
  }

  /// The raw form, for callers that already have a type and message rather
  /// than an `Error` — MetricKit's crash payloads, mainly.
  static func captureException(
    type: String, message: String, source: String, extra: [String: Any] = [:]
  ) {
    guard let client, mode == .full else { return }
    var props = baseProps()
    props["$exception_type"] = type
    props["$exception_message"] = scrub(message).prefix(2000).description
    props["$exception_level"] = "error"
    props["source"] = source
    for (key, value) in extra { props[key] = value }
    client.capture("$exception", properties: props)
  }

  static func flush() {
    client?.flush()
  }

  // MARK: Props

  /// Only in `full` mode — the heartbeat deliberately skips this so a
  /// presence-only install leaks no device detail at all.
  private static func baseProps() -> [String: Any] {
    [
      "app_version": appVersion,
      "build_number": infoString("CFBundleVersion") ?? "",
      "platform": "ios",
      "os_version": UIDevice.current.systemVersion,
      "device_model": deviceModel,
      "is_testflight": isTestFlight,
      "client": "ios",
    ]
  }

  /// PostHog counts DAU from `$pageview`, so presence-only installs are only
  /// countable at all because of this. It carries `app_version` and nothing
  /// else; the path is a fixed literal with no identifiers in it.
  private static func captureHeartbeat() {
    client?.capture(
      "$pageview",
      properties: [
        "$current_url": "argus-ios:///",
        "$pathname": "/",
        "app_version": appVersion,
        "source": "heartbeat",
      ])
  }

  private static var appVersion: String {
    infoString("CFBundleShortVersionString") ?? ""
  }

  /// The hardware identifier (`iPhone16,1`), not the user-chosen device name.
  private static var deviceModel: String {
    var system = utsname()
    uname(&system)

    return withUnsafeBytes(of: &system.machine) { raw in
      String(cString: raw.baseAddress!.assumingMemoryBound(to: CChar.self))
    }
  }

  /// TestFlight installs are signed for the sandbox store.
  private static func sandboxed() async -> Bool {
    switch try? await AppTransaction.shared {
    case .verified(let transaction), .unverified(let transaction, _): transaction.environment == .sandbox
    case nil: false
    }
  }

  private static func infoString(_ key: String) -> String? {
    Bundle.main.object(forInfoDictionaryKey: key) as? String
  }

  // MARK: Identity

  private static func anonymousId() -> String {
    if let stored = preferences.string(PreferenceKey.telemetryId), !stored.isEmpty {
      return stored
    }
    let fresh = UUID().uuidString
    preferences.set(fresh, for: PreferenceKey.telemetryId)

    return fresh
  }

  // MARK: Errors

  /// ObjC exceptions only — Swift runtime traps and signals go through
  /// MetricKit on the next launch instead.
  private static func installExceptionHandler() {
    NSSetUncaughtExceptionHandler { exception in
      MainActor.assumeIsolated {
        Telemetry.captureException(
          type: exception.name.rawValue,
          message: exception.reason ?? "",
          source: "uncaughtException",
          extra: [
            "$exception_stack_trace_raw": Telemetry.scrub(exception.callStackSymbols.joined(separator: "\n"))
          ])
        Telemetry.flush()
      }
    }
  }

  /// Strip anything that looks like a file path. The phone displays host-side
  /// paths — repo roots, branch names — and they otherwise ride along inside
  /// error messages.
  nonisolated static func scrub(_ message: String) -> String {
    var scrubbed = message
    for (pattern, replacement) in [
      ("/Users/[^/\\s'\")]+", "/Users/<user>"),
      ("/home/[^/\\s'\")]+", "/home/<user>"),
      ("/var/mobile/Containers/[^\\s'\")]+", "/var/mobile/Containers/<path>"),
      ("/private/var/[^\\s'\")]+", "/private/var/<path>"),
    ] {
      scrubbed = scrubbed.replacingOccurrences(
        of: pattern, with: replacement, options: .regularExpression)
    }

    return scrubbed
  }
}

extension TelemetryEvent {
  /// The shared stores report what they did; this is where it joins the
  /// phone's catalog.
  init(_ event: StoreEvent) {
    switch event {
    case .messageSent(let queued, let hasImages, let length):
      self = .messageSent(queued: queued, hasImages: hasImages, length: length)
    case .messageSendFailed(let retried):
      self = .messageSendFailed(retried: retried)
    case .permissionAnswered(let approved, let alwaysAllow, let fromNotification):
      self = .permissionAnswered(
        approved: approved, alwaysAllow: alwaysAllow, fromNotification: fromNotification)
    case .agentControlled(let action):
      self = .agentControlled(action: action)
    case .workLanded(let action, let success, let strategy):
      self = .workLanded(action: action, success: success, strategy: strategy)
    case .commitComposed(let hasDescription, let signOff, let signed):
      self = .commitComposed(hasDescription: hasDescription, signOff: signOff, signed: signed)
    case .claudeAccountChanged(let action):
      self = .claudeAccountChanged(action: action)
    case .automationEdited(let action):
      self = .automationEdited(action: action)
    case .runActed(let action):
      self = .runActed(action: action)
    case .proposalHandled(let action):
      self = .proposalHandled(action: action)
    case .pullRequestActed(let action):
      self = .pullRequestActed(action: action)
    case .branchActed(let action):
      self = .branchActed(action: action)
    case .sessionRenamed(let target):
      self = .sessionRenamed(target: target)
    case .memoryEdited(let action):
      self = .memoryEdited(action: action)
    case .diffReviewed(let action, let comments):
      self = .diffReviewed(action: action, comments: comments)
    case .offlineReply(let action):
      self = .offlineReply(action: action)
    }
  }
}
