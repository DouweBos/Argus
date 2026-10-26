import ArgusKit
import Foundation

/// Picking which Claude Code CLI projects to add: what's pre-ticked and how a row reads.
public enum CliProjectImport {
  /// Pre-ticked: not yet a project, at least this many chats, used this recently.
  public static let defaultMinChats = 3.0
  public static let defaultMaxAge: TimeInterval = 30 * 86_400

  public static func isDefaultSelected(_ candidate: ArgusProtocol.CliProjectCandidate, now: Date)
    -> Bool
  {
    let ageSeconds = now.timeIntervalSince1970 - candidate.lastActiveAt / 1000
    return !candidate.added && candidate.chatCount >= defaultMinChats && ageSeconds <= defaultMaxAge
  }

  public static func defaultSelection(_ candidates: [ArgusProtocol.CliProjectCandidate], now: Date)
    -> Set<String>
  {
    Set(candidates.filter { isDefaultSelected($0, now: now) }.map(\.path))
  }

  /// Compact age: "now", "1m", "4h", "6d", "3mo", "2y".
  public static func shortAge(sinceMs: Double, now: Date) -> String {
    let diff = max(0, now.timeIntervalSince1970 - sinceMs / 1000)
    let minute = 60.0
    let hour = 60 * minute
    let day = 24 * hour
    switch diff {
    case ..<minute: return "now"
    case ..<hour: return "\(Int(diff / minute))m"
    case ..<day: return "\(Int(diff / hour))h"
    case ..<(30 * day): return "\(Int(diff / day))d"
    case ..<(365 * day): return "\(Int(diff / (30 * day)))mo"
    default: return "\(Int(diff / (365 * day)))y"
    }
  }

  public static func chatCount(_ count: Double) -> String {
    let n = Int(count)
    return n == 1 ? "1 chat" : "\(n) chats"
  }

  public static func importLabel(_ count: Int) -> String {
    count == 1 ? "Import 1 project" : "Import \(count) projects"
  }
}
