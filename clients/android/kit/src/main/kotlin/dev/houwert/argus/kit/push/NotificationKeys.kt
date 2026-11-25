package dev.houwert.argus.kit.push

/**
 * Identifiers shared with the desktop's push dispatcher. The desktop names the
 * action ids, so these strings are a contract: renaming one drops Approve/Deny.
 */
object NotificationAction {
  const val APPROVE = "approve"
  const val DENY = "deny"
  const val SWITCH_ACCOUNT = "switch_account"
}

/** Keys of the extras a posted notification carries back to the app on tap or action. */
object NotificationExtra {
  const val AGENT_ID = "agentId"
  const val SESSION_ID = "sessionId"
  const val TOOL_USE_ID = "toolUseId"
  const val LABEL = "label"
  const val KIND = "kind"
  const val ACCOUNT_ID = "accountId"
}

/** Keys of the FCM data message the relay forwards. */
object PushData {
  /** The sealed notification, as the APNs payload's `e`. */
  const val SEALED = "e"
  /** A content-free account wake-up: `join` or `changed`. */
  const val ACCOUNT = "account"
}
