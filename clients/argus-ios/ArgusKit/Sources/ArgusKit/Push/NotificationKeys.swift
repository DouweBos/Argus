import Foundation

/// Identifiers shared between the app, the notification extension and the
/// desktop's push dispatcher. The desktop names the category and the action
/// ids, so these strings are a contract — renaming one silently drops the
/// Approve/Deny buttons.
public enum NotificationCategory {
  public static let permission = "argus.permission"
}

public enum NotificationAction {
  public static let approve = "approve"
  public static let deny = "deny"
}

public enum NotificationUserInfoKey {
  public static let agentId = "agentId"
  public static let sessionId = "sessionId"
  public static let toolUseId = "toolUseId"
  public static let label = "label"
  public static let kind = "kind"
}
