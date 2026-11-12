/// Which setting changed, for `mac_settings_changed` — the field, never its value.
enum SettingsField: String {
  case theme
  case colorTheme = "color_theme"
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
  case permissionMode = "permission_mode"
  case automationsEnabled = "automations_enabled"
  case followUpSuggestions = "follow_up_suggestions"
  case warmAgents = "warm_agents"
  case defaultAutonomy = "default_autonomy"
  case concurrency
  case dailyBudget = "daily_budget"
  case importCliChats = "import_cli_chats"
  case saveChatHistory = "save_chat_history"
  case allowedCommands = "allowed_commands"
  case allowedTools = "allowed_tools"
  case refusalAllowed = "refusal_allowed"
  case refusalDismissed = "refusal_dismissed"
  case runner
  case llmModel = "llm_model"
  case customRunnerSaved = "custom_runner_saved"
  case customAcpAgentSaved = "custom_acp_agent_saved"
  case customRunnerDeleted = "custom_runner_deleted"
  case mcpServers = "mcp_servers"
  case mcpTested = "mcp_tested"
  case mcpSignedIn = "mcp_signed_in"
  case mcpSignedOut = "mcp_signed_out"
  case toolToggled = "tool_toggled"
  case prereqFixed = "prereq_fixed"
  case conductorVersion = "conductor_version"
  case updateChannel = "update_channel"
  case editorFont = "editor_font"
  case editorFontSize = "editor_font_size"
  case editorTabWidth = "editor_tab_width"
  case editorInsertSpaces = "editor_insert_spaces"
  case editorWrapLines = "editor_wrap_lines"
  case editorShowInvisibles = "editor_show_invisibles"
  case editorFormatOnSave = "editor_format_on_save"
  case openFileLinksIn = "open_file_links_in"
  case languageServers = "language_servers"
  case linearMarkStarted = "linear_mark_started"
  case linearReport = "linear_report"
  case commitMessageStyle = "commit_message_style"
  case commitMessageInstructions = "commit_message_instructions"

  var section: SettingsTab {
    switch self {
    case .theme, .colorTheme, .displaySize: .appearance
    case .launchRoute, .worktreeLocation, .automationWorktreeLocation, .customEditors, .telemetryMode:
      .general
    case .accountSelected, .accountAdded, .accountRemoved, .accountRenamed, .accountReauth:
      .accounts
    case .permissionMode, .automationsEnabled, .followUpSuggestions, .warmAgents, .defaultAutonomy,
      .concurrency, .dailyBudget, .importCliChats, .saveChatHistory, .allowedCommands, .allowedTools, .refusalAllowed,
      .refusalDismissed:
      .agents
    case .runner, .llmModel, .customRunnerSaved, .customAcpAgentSaved, .customRunnerDeleted: .llm
    case .mcpServers, .mcpTested, .mcpSignedIn, .mcpSignedOut: .mcp
    case .toolToggled, .prereqFixed, .conductorVersion: .tools
    case .updateChannel: .advanced
    case .linearMarkStarted, .linearReport: .integrations
    case .commitMessageStyle, .commitMessageInstructions: .git
    case .editorFont, .editorFontSize, .editorTabWidth, .editorInsertSpaces, .editorWrapLines,
      .editorShowInvisibles, .editorFormatOnSave, .openFileLinksIn, .languageServers:
      .editor
    }
  }
}
