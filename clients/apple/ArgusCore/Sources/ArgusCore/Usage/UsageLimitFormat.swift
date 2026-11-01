import ArgusKit
import Foundation

/// How full a plan window is, for picking its meter's tone.
public enum UsageLevel: Equatable, Sendable {
  case normal, warning, critical
}

/// The words and numbers a plan-limit meter shows, kept out of the views so
/// both apps say the same thing.
public enum UsageLimitFormat {
  /// What is left, rounded down so "100% left" means nothing was used.
  public static func percentLeft(usedPercent: Double) -> Int {
    Int((100 - min(100, max(0, usedPercent))).rounded(.down))
  }

  /// The used share as a 0–1 fraction for a progress bar.
  public static func fraction(usedPercent: Double) -> Double {
    min(1, max(0, usedPercent / 100))
  }

  public static func level(usedPercent: Double) -> UsageLevel {
    if usedPercent > 95 { return .critical }
    if usedPercent > 80 { return .warning }
    return .normal
  }

  /// "5d 1h", "4h 29m", "12m", or "<1m"; nil once the moment has passed.
  public static func countdown(until resetsAtMs: Double, now: Date) -> String? {
    let seconds = resetsAtMs / 1000 - now.timeIntervalSince1970
    guard seconds > 0 else { return nil }
    let minutes = Int(seconds / 60)
    let days = minutes / 1440
    let hours = (minutes % 1440) / 60
    let mins = minutes % 60
    if days > 0 { return "\(days)d \(hours)h" }
    if hours > 0 { return "\(hours)h \(mins)m" }
    if mins > 0 { return "\(mins)m" }
    return "<1m"
  }

  /// "Resets in 4h 29m", "Resetting now" once due, nil without a reset time.
  public static func resetCaption(resetsAtMs: Double?, now: Date) -> String? {
    guard let resetsAtMs else { return nil }
    guard let countdown = countdown(until: resetsAtMs, now: now) else { return "Resetting now" }
    return "Resets in \(countdown)"
  }

  public static func paceCaption(_ pace: ArgusProtocol.UsagePace?) -> String? {
    switch pace {
    case .ahead?: "Ahead of pace"
    case .on?: "On pace"
    case .under?: "Under pace"
    default: nil
    }
  }
}
