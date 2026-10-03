/// Which setting changed, for `mac_settings_changed` — the field, never its value.
enum SettingsField: String {
  case theme
  case displaySize = "display_size"
  case launchRoute = "launch_route"
  case worktreeLocation = "worktree_location"
  case automationWorktreeLocation = "automation_worktree_location"
  case customEditors = "custom_editors"
  case telemetryMode = "telemetry_mode"
  case accountSelected = "account_selected"
  case accountAdded = "account_added"
  case accountRemoved = "account_removed"
  case accountRenamed = "account_renamed"
  case accountReauth = "account_reauth"
  case defaultModel = "default_model"
  case permissionMode = "permission_mode"
  case automationsEnabled = "automations_enabled"
  case defaultAutonomy = "default_autonomy"
  case concurrency
  case dailyBudget = "daily_budget"
  case allowedCommands = "allowed_commands"
  case allowedTools = "allowed_tools"
  case refusalAllowed = "refusal_allowed"
  case refusalDismissed = "refusal_dismissed"
  case runner
  case llmModel = "llm_model"
  case customRunnerSaved = "custom_runner_saved"
  case customRunnerDeleted = "custom_runner_deleted"
  case mcpServers = "mcp_servers"
  case mcpTested = "mcp_tested"
  case mcpSignedIn = "mcp_signed_in"
  case mcpSignedOut = "mcp_signed_out"
  case toolToggled = "tool_toggled"
  case prereqFixed = "prereq_fixed"
  case conductorVersion = "conductor_version"
  case updateChannel = "update_channel"

  var section: SettingsTab {
    switch self {
    case .theme, .displaySize, .launchRoute, .worktreeLocation, .automationWorktreeLocation,
      .customEditors, .telemetryMode:
      .general
    case .accountSelected, .accountAdded, .accountRemoved, .accountRenamed, .accountReauth:
      .accounts
    case .defaultModel, .permissionMode, .automationsEnabled, .defaultAutonomy, .concurrency,
      .dailyBudget, .allowedCommands, .allowedTools, .refusalAllowed, .refusalDismissed:
      .agents
    case .runner, .llmModel, .customRunnerSaved, .customRunnerDeleted: .llm
    case .mcpServers, .mcpTested, .mcpSignedIn, .mcpSignedOut: .mcp
    case .toolToggled, .prereqFixed, .conductorVersion: .tools
    case .updateChannel: .advanced
    }
  }
}
