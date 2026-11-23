import ArgusKit
import Foundation

/// What both editors share about picking and checking a trigger.
extension RemoteAutomationDetail {
  /// The editors' trigger picker, in order.
  public static let triggerOptions: [(RemoteAutomation.TriggerKind, String)] = [
    (.schedule, "Schedule"), (.once, "Once"), (.signal, "Signal"), (.webhook, "Webhook"), (.manual, "Manual"),
  ]

  /// Switching kinds starts from something that saves: the next whole hour
  /// for Once, a new-issue signal, a webhook at the default cap.
  public mutating func setTriggerKind(_ kind: RemoteAutomation.TriggerKind) {
    triggerKind = kind
    switch kind {
    case .once where runAt == nil: runAt = OnceTime.nextWholeHour(timezone: timezone)
    case .signal where signal == nil: signal = RemoteAutomationSignal()
    case .webhook where webhook == nil: webhook = RemoteAutomationWebhook()
    default: break
    }
  }

  /// Why a signal trigger can't be saved; nil for other kinds or a good one.
  public var signalError: String? {
    guard triggerKind == .signal else { return nil }
    return (signal?.on.isEmpty ?? true) ? "Pick at least one event to react to." : nil
  }

  /// What the trigger section's footer says.
  public var triggerCaption: String {
    switch triggerKind {
    case .schedule: "Five fields: minute hour day-of-month month day-of-week."
    case .once: "Runs once at this time, then pauses itself."
    case .manual: "Only runs when someone presses Run now."
    case .signal: AutomationTriggerText.signalCaption
    case .webhook: AutomationTriggerText.webhookCaption
    }
  }
}

/// Copy the Mac and phone event-trigger fields share.
public enum AutomationTriggerText {
  public static let signalCaption =
    "Checks GitHub, GitLab and Linear every 2 minutes. New issues and pull requests are only "
    + "watched in this automation's projects. Linear reports new issues and assignments, once "
    + "it's connected in Settings › Integrations."
  public static let webhookCaption =
    "Runs when a signed POST reaches this URL. Sign the body with the secret as "
    + "X-Hub-Signature-256: sha256=<hmac>, or send Authorization: Bearer <secret>."
  public static let labelsPlaceholder = "bug, needs-triage"
  public static let labelsCaption = "Only events with one of these labels. Leave empty for all."
  public static let capCaption = "Runs it may start in an hour, at most."
  public static let noUrl = "Turn on remote access to get a URL."
  public static let unsaved = "Save the automation to get its URL and secret."
  public static let secretOnce = "Copy it now: it won't be shown again."

  public static func secretButton(hasSecret: Bool) -> String {
    hasSecret ? "Regenerate secret" : "Generate secret"
  }

  /// Comma-separated text to the label list, and back.
  public static func labels(_ text: String) -> [String] {
    text.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
  }

  public static func labelsText(_ labels: [String]) -> String {
    labels.joined(separator: ", ")
  }

  public static func clampRuns(_ value: Double) -> Double {
    min(max(value.rounded(), RemoteAutomationSignal.runsPerHourRange.lowerBound),
      RemoteAutomationSignal.runsPerHourRange.upperBound)
  }
}
