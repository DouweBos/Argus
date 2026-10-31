import ArgusKit
import Foundation

/// How a device on the account is named and drawn, the same on the Mac and the phone.
public enum AccountMemberText {
  public static func icon(_ member: AccountMember?) -> String {
    switch member?.kind {
    case "ios": "iphone"
    case "mac": "laptopcomputer"
    case "web": "globe"
    default: Icon.desktop
    }
  }

  public static func kind(_ member: AccountMember?) -> String {
    guard let member else { return "" }
    if member.role == .host { return member.platform == "linux" ? "Linux computer" : "Mac computer" }
    switch member.kind {
    case "ios": return "iPhone"
    case "mac": return "Mac app"
    case "web": return "Browser"
    default: return "Desktop app"
    }
  }

  /// Kind, date, and the code it was approved with, so a device approved
  /// while it was away can check it.
  public static func detail(_ member: AccountMember, code: String?) -> String {
    let base = "\(kind(member)) · added \(added(member))"
    return code.map { "\(base) · code \(groupedCode($0))" } ?? base
  }

  public static func added(_ member: AccountMember) -> String {
    Date(timeIntervalSince1970: member.createdAt / 1000).formatted(date: .abbreviated, time: .omitted)
  }

  /// A six-digit approval code read as two halves, the way both screens show it.
  public static func groupedCode(_ code: String) -> String {
    code.count == 6 ? "\(code.prefix(3)) \(code.suffix(3))" : code
  }
}

/// "Online", or "Offline · last seen 2 h ago".
public enum AccountPresenceText {
  public static func text(online: Bool, lastSeen: Double?, now: Date = Date()) -> String {
    if online { return "Online" }
    guard let lastSeen else { return "Offline" }
    let formatter = RelativeDateTimeFormatter()
    formatter.unitsStyle = .abbreviated
    let seen = Date(timeIntervalSince1970: lastSeen / 1000)
    return "Offline · last seen \(formatter.localizedString(for: seen, relativeTo: now))"
  }
}
