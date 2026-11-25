import Foundation

/// Identifiers shared between the app, the notification extension and the
/// desktop's push dispatcher. The desktop names the category and the action
/// ids, so these strings are a contract — renaming one silently drops the
/// Approve/Deny buttons.
public enum NotificationCategory {
  public static let permission = "argus.permission"
  /// A usage warning offering to switch the computer's Claude account.
  public static let usage = "argus.usage"

  /// The category that draws a notification's buttons, from the action ids the desktop sent.
  public static func forActions(_ ids: [String]) -> String? {
    if ids.contains(NotificationAction.switchAccount) { return usage }
    return ids.isEmpty ? nil : permission
  }
}

public enum NotificationAction {
  public static let approve = "approve"
  public static let deny = "deny"
  public static let switchAccount = "switch_account"
}

public enum NotificationUserInfoKey {
  public static let agentId = "agentId"
  public static let sessionId = "sessionId"
  public static let toolUseId = "toolUseId"
  public static let label = "label"
  public static let kind = "kind"
  public static let accountId = "accountId"
}
