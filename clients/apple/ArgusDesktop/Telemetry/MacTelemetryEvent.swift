import ArgusCore
import Foundation

/// Every event the Mac app sends itself — the Swift analogue of
/// `packages/host/src/telemetryEvents.ts`, so the wrong props don't compile.
///
/// The host already captures what it does on the app's behalf (`agent_started`,
/// `session_created`, …), so only what the host cannot see is here: the app's
/// own lifecycle, the supervisor, the host-lock handover, and navigation.
enum MacTelemetryEvent {
  enum Holder: String {
    case electron
    case mac
    case macServer = "mac_server"
    case cli
  }

  /// Whether the window runs its own host or is a second window on another app's.
  enum HostMode: String {
    case own
    case attached
  }

  enum LinkAction: String {
    case open
    case openInEditor = "open_in_editor"
    case openInArgus = "open_in_argus"
    case reveal
    case copyPath = "copy_path"
    case openUrl = "open_url"
    case copyLink = "copy_link"
  }

  /// How much of the transcript a copy took.
  enum CopySpan: String {
    case selection
    case acrossMessages = "across_messages"
  }

  enum MessageAction: String {
    case copy
    case edit
    case forkSession = "fork_session"
    case forkAgent = "fork_agent"
  }

  enum MessageRole: String {
    case user
    case assistant
  }

  enum ImageViewerAction: String {
    case open
    case page
    case copy
    case save
    case openPreview = "open_preview"
  }

  enum TerminalAction: String {
    case newShell = "new_shell"
    case close
    case rename
    case run
    case stop
    /// A `single_runtime` project's other run was stopped to start this one.
    case stopOthersAndRun = "stop_others_and_run"
    case openLink = "open_link"
  }

  /// How the cost prompt before an EAS Simulator session was answered.
  enum EasPromptOutcome: String {
    case confirmed
    case cancelled
  }

  enum PowerAction: String {
    case boot
    case shutdown
    case disconnect
  }

  enum BrowserAction: String {
    /// Started from the panel's Open Browser button.
    case open
    case navigate
    case back
    case forward
    case reload
    case preset
  }

  enum InspectionAction: String {
    case capture
    case launch
    case select
    case edit
  }

  /// What a git action did, from any git view. GroveKit runs these in the app,
  /// so the host never sees them; host-run ones (merge into base, PRs) are
  /// captured there instead.
  enum HostsAction: String {
    case pair, attach, detach, forget, rename, focus
  }

  enum AccountMemberAction: String {
    case removed, renamed
  }

  enum GitViewSource: String {
    case tabs
    case more
  }

  enum GitAction: String {
    case stage
    case unstage
    case stageHunk = "stage_hunk"
    case unstageHunk = "unstage_hunk"
    case stageLines = "stage_lines"
    case unstageLines = "unstage_lines"
    case discard
    case discardHunk = "discard_hunk"
    case discardLines = "discard_lines"
    case commit
    case amend
    case checkout
    case branchCreate = "branch_create"
    case branchRename = "branch_rename"
    case branchDelete = "branch_delete"
    case merge
    case rebase
    case interactiveRebase = "interactive_rebase"
    case cherryPick = "cherry_pick"
    case revert
    case reset
    case reword
    case squash
    case drop
    case stashCreate = "stash_create"
    case stashApply = "stash_apply"
    case stashPop = "stash_pop"
    case stashDrop = "stash_drop"
    case tagCreate = "tag_create"
    case tagDelete = "tag_delete"
    case fetch
    case pull
    case push
    /// Fetch, pull and push in one go, from the toolbar's Sync.
    case sync
    case resolveConflict = "resolve_conflict"
    case continueOperation = "continue_operation"
    case abortOperation = "abort_operation"
    case restoreFile = "restore_file"
    /// Ignore, stop tracking, rename, move to Trash or track with LFS from the changes list.
    case fileAction = "file_action"
    case undo
    case redo
    case bisect
    case submodule
    case remote
    case hook
    /// Repo config, auto-fetch or a per-project git preference changed.
    case config
    /// Pin or unpin a branch in the sidebar.
    case pin
    /// Archive or unarchive a branch in the sidebar.
    case archive
    case setUpstream = "set_upstream"
    /// A commit template or gitmoji went into the composer.
    case template
    case gitmoji
    /// The repository's commit identity switched to a saved profile.
    case identity
    case patchCreate = "patch_create"
    case patchApply = "patch_apply"
  }

  /// How the sidebar list was narrowed.
  enum SidebarFilterKind: String {
    case search
    case project
  }

  /// What a session's context card was used for.
  enum ContextCardAction: String {
    case collapse
    case expand
    case recentChats = "recent_chats"
    case openEditor = "open_editor"
    case reveal
    case copyPath = "copy_path"
    case run
    case share
    case branch
    case push
    case changes
    case linkedIssue = "linked_issue"
  }

  case launched
  case quit(hadRunningAgents: Bool)
  case hostStarted(restarts: Int)
  case hostCrashed(exitCode: Int, attempt: Int)
  case hostFailed(crashes: Int)
  case hostLockConflict(holder: Holder)
  case hostHandover(holder: Holder, success: Bool)
  /// `holder` only when attached: whose host the window joined.
  case hostConnected(mode: HostMode, holder: Holder?)
  /// The host is too old for something the app asked; `method` is a protocol name.
  case hostFeatureUnsupported(method: String)
  /// `screen` is a route pattern, never an id.
  case screenViewed(screen: String)
  /// A saved chat was opened, resumed or deleted from a session's home.
  case chatHistoryUsed(action: ChatHistoryAction)
  /// A home card's button was used: notifications enabled, opened or dismissed,
  /// or a project removed from the recents grid.
  case homeCardActed(card: HomeCard, action: HomeCardAction)
  /// A scratch pad was created from the sidebar.
  case scratchPadCreated
  /// On connect this app handed the host preferences it had no value for yet.
  case prefsSupplied(keys: Int)
  /// A window tab was opened, closed or switched to.
  case tabUsed(action: TabAction)
  /// A session's Home, Agents, Code or Git panel was picked from the toolbar, the View menu or the palette.
  case sessionPanelSwitched(panel: String, via: PanelSwitchSource)
  /// One of the keyboard commands for agents, panels and screens was used.
  case menuCommandUsed(action: MenuCommandAction, via: MenuCommandSource)
  /// An item in the menu-bar item's menu that does something.
  case menuBarUsed(action: MenuBarAction)
  /// The menu-bar item was shown or hidden, from Settings or by dragging it off the menu bar.
  case menuBarToggled(shown: Bool, via: MenuBarToggleSource, serverInstalled: Bool)
  /// Open at Login was switched; `status` is what macOS made of it.
  case loginItem(enabled: Bool, status: LoginItemStatus)
  /// Back or Forward through the window tab's history.
  case navigatedHistory(direction: HistoryDirection, via: HistorySource)
  /// A folder was browsed for on a paired host's disk.
  case hostFolderPicked(stage: FolderPickStage)
  /// A session's branch was renamed from its home.
  case branchRenamed(success: Bool)
  /// A project in the sidebar was folded shut or opened.
  case sidebarProjectToggled(collapsed: Bool)
  /// The sidebar was searched (once per search) or narrowed to one project.
  case sidebarFiltered(kind: SidebarFilterKind)
  /// A session's context card was shown, hidden, or one of its actions used.
  case contextCardUsed(action: ContextCardAction)
  /// A deep link or launch route was opened; `screen` is its route pattern.
  case linkOpened(screen: String, outcome: LinkOutcome)
  /// A transcript link was used; `relative` is whether the path needed the worktree.
  case transcriptLinkOpened(action: LinkAction, relative: Bool)
  /// Find in chat was closed after a search. Counts are bucketed, never the query.
  case transcriptFindUsed(matches: String, navigated: Bool)
  /// Transcript text was copied with ⌘C or the context menu.
  case transcriptCopied(span: CopySpan)
  /// A turn's folded work log was opened; `working` is whether the agent was still at it.
  case transcriptWorkLogOpened(working: Bool)
  /// The image viewer was opened, paged, or an image copied, saved or opened in Preview from it.
  case imageViewerUsed(action: ImageViewerAction)
  /// A message's hover action was used; edit and fork report whether the host took it.
  case messageAction(action: MessageAction, role: MessageRole, success: Bool)
  /// A chat-input feature the host can't tell from a plain send.
  case inputUsed(affordance: String)
  /// Something done to a terminal from the panel or the run control.
  case terminalUsed(action: TerminalAction)
  /// A terminal view attached and replayed the host's captured output.
  case terminalReplayed(bytes: String, truncated: Bool)
  /// Find in a terminal was closed after a search.
  case terminalFindUsed(matches: String, navigated: Bool)
  /// A runtime target was picked; `platform` is `ios`, `android` or `web`.
  case runtimeTargetPicked(platform: String)
  /// A device picture was closed after being shown.
  case deviceWatched(platform: String, durationMs: Int, interacted: Bool)
  case devicePopoutOpened(platform: String)
  /// The side panel was shown or hidden for the session on screen.
  case panelToggled(shown: Bool, via: PanelSource)
  /// A side panel tab was opened or brought to the front.
  case panelTabOpened(kind: PanelTabKind, via: PanelSource)
  case devicePower(action: PowerAction, platform: String)
  /// The cost prompt before booting a stopped EAS Simulator device was answered.
  case easSessionStartPrompted(outcome: EasPromptOutcome)
  case browserUsed(action: BrowserAction)
  case inspectionUsed(action: InspectionAction, success: Bool)
  /// A git action from the git panel; `scope` is `session` or `project`,
  /// `remote` when the session is on a paired host.
  case gitUsed(action: GitAction, scope: String, remote: Bool, success: Bool)
  /// A fix was picked from a git error banner; `kind` and `action` are the banner's enums.
  case gitRecoveryUsed(kind: String, action: String)
  /// A git view was picked from the panel's pill bar or its More menu; `view` is the route segment.
  case gitViewPicked(view: String, via: GitViewSource)
  /// Diffs switched between unified and split, from a diff's header or Settings.
  case diffLayoutChanged(layout: String, via: DiffLayoutSetting.Source)
  /// Another host was paired, attached, detached, forgotten, renamed or shown.
  case hostsUsed(action: HostsAction, success: Bool)
  /// A pull request was opened, merged, commented on or closed through the host's `gh`.
  case pullRequestActed(action: PullRequestAction)
  /// This Mac asked to join the account, or approved or denied a device joining it.
  case accountJoinActed(action: AccountStore.JoinAction, role: AccountStore.JoinRole)
  /// This Mac removed or renamed a member of the account.
  case accountMemberChanged(action: AccountMemberAction, role: AccountMember.Role)
  /// This Mac's name setting changed; `linked`: renamed on the account too.
  case deviceNameChanged(source: AccountStore.NameSource, linked: Bool)
  /// A command palette entry was run; `section` is its group, never its title.
  case paletteCommandRun(section: String)
  /// The phone handed a session over; `matched` is whether it named this computer.
  case handoffContinued(matched: Bool)
  /// A first-run step was finished or skipped; `step` is the step's id.
  case onboardingStep(step: String, skipped: Bool)
  /// A one-click fixer ran; `prereq` is the check's id.
  case prereqFixed(prereq: String, success: Bool)
  case projectAdded(source: ProjectSource)
  case argusJsonGenerated(method: ArgusJsonMethod, outcome: ArgusJsonOutcome)
  /// Project Settings saved; `changed` buckets how many top-level keys moved.
  case projectSettingsSaved(changed: String, personal: Bool, success: Bool)
  /// A setting was changed in the Settings window; never its value.
  case settingsChanged(setting: SettingsField)
  /// A Remote Access setting was changed; `on` only for toggles.
  case remoteSettingChanged(setting: RemoteSetting, on: Bool?)
  /// A pairing moved on; `client` is the kind the device claimed, or `unknown`.
  case pairing(stage: PairingStage, client: String)
  case remoteDeviceManaged(action: RemoteDeviceAction, success: Bool)
  /// An attached host's live link moved to a better route (e.g. tunnel → Wi-Fi) without dropping.
  case routeUpgraded(from: RemoteEndpoint.Kind, to: RemoteEndpoint.Kind)
  /// Something done to a huddle from its sheet, chat or join requests.
  case huddleUsed(action: HuddleAction, hasDevice: Bool)
  case automationEdited(action: StoreEvent.AutomationAction)
  case runActed(action: StoreEvent.RunAction)
  case proposalHandled(action: StoreEvent.ProposalAction)
  case memoryEdited(action: StoreEvent.MemoryAction)
  /// The code view read a file into a tab; `language` is a bundled grammar or `other`.
  case editorFileOpened(source: EditorOpenSource, language: String, sizeBucket: String, readOnly: Bool)
  case editorFileSaved(formatted: Bool, formatter: EditorFormatter, hadConflict: Bool)
  case editorConflictResolved(action: EditorConflictAction)
  /// A clean buffer took an agent's (or anyone's) change from disk; once per file per session.
  case editorExternalReload(agentRunning: Bool)
  case editorHighlightUnavailable(language: String, reason: String)
  case editorSearchRun(scope: EditorSearchScope, regex: Bool, resultBucket: String, truncated: Bool)
  case editorAskAgent(source: EditorAskSource, startedAgent: Bool)
  case editorCompletionAccepted(language: String)
  /// An editor command ran (comment, move line, add cursor, …); once per command per open file.
  case editorCommand(command: String)
  /// Quick open closed: what it was asked for, and whether something was opened.
  case editorQuickOpenUsed(mode: EditorQuickOpenMode, result: EditorQuickOpenResult)

  var name: String {
    switch self {
    case .launched: "mac_launched"
    case .quit: "mac_quit"
    case .hostStarted: "mac_host_started"
    case .hostCrashed: "mac_host_crashed"
    case .hostFailed: "mac_host_failed"
    case .hostLockConflict: "mac_host_lock_conflict"
    case .hostHandover: "mac_host_handover"
    case .hostConnected: "mac_host_connected"
    case .hostFeatureUnsupported: "mac_host_feature_unsupported"
    case .screenViewed: "mac_screen_viewed"
    case .linkOpened: "mac_link_opened"
    case .chatHistoryUsed: "mac_chat_history_used"
    case .branchRenamed: "mac_branch_renamed"
    case .sidebarProjectToggled: "mac_sidebar_project_toggled"
    case .sidebarFiltered: "mac_sidebar_filtered"
    case .contextCardUsed: "mac_context_card_used"
    case .homeCardActed: "mac_home_card_acted"
    case .hostFolderPicked: "mac_host_folder_picked"
    case .tabUsed: "mac_tab_used"
    case .sessionPanelSwitched: "mac_session_panel_switched"
    case .menuCommandUsed: "mac_menu_command_used"
    case .menuBarUsed: "mac_menu_bar_used"
    case .menuBarToggled: "mac_menu_bar_toggled"
    case .loginItem: "mac_login_item"
    case .navigatedHistory: "mac_navigated_history"
    case .scratchPadCreated: "mac_scratch_pad_created"
    case .prefsSupplied: "mac_prefs_supplied"
    case .transcriptLinkOpened: "mac_transcript_link_opened"
    case .transcriptFindUsed: "mac_transcript_find_used"
    case .transcriptCopied: "mac_transcript_copied"
    case .transcriptWorkLogOpened: "mac_transcript_work_log_opened"
    case .imageViewerUsed: "mac_image_viewer_used"
    case .messageAction: "mac_message_action"
    case .inputUsed: "mac_input_used"
    case .terminalUsed: "mac_terminal_used"
    case .terminalReplayed: "mac_terminal_replayed"
    case .terminalFindUsed: "mac_terminal_find_used"
    case .runtimeTargetPicked: "mac_runtime_target_picked"
    case .deviceWatched: "mac_device_watched"
    case .devicePopoutOpened: "mac_device_popout_opened"
    case .panelToggled: "mac_panel_toggled"
    case .panelTabOpened: "mac_panel_tab_opened"
    case .devicePower: "mac_device_power"
    case .easSessionStartPrompted: "mac_eas_session_start_prompted"
    case .browserUsed: "mac_browser_used"
    case .inspectionUsed: "mac_inspection_used"
    case .gitUsed: "mac_git_used"
    case .gitRecoveryUsed: "mac_git_recovery_used"
    case .gitViewPicked: "mac_git_view_picked"
    case .diffLayoutChanged: "mac_diff_layout_changed"
    case .hostsUsed: "mac_hosts_used"
    case .pullRequestActed: "mac_pull_request_acted"
    case .accountJoinActed: "mac_account_join_acted"
    case .accountMemberChanged: "mac_account_member_changed"
    case .deviceNameChanged: "mac_device_name_changed"
    case .paletteCommandRun: "mac_palette_command_run"
    case .handoffContinued: "mac_handoff_continued"
    case .onboardingStep: "mac_onboarding_step"
    case .prereqFixed: "mac_prereq_fixed"
    case .projectAdded: "mac_project_added"
    case .argusJsonGenerated: "mac_argus_json_generated"
    case .projectSettingsSaved: "mac_project_settings_saved"
    case .settingsChanged: "mac_settings_changed"
    case .remoteSettingChanged: "mac_remote_setting_changed"
    case .pairing: "mac_pairing"
    case .remoteDeviceManaged: "mac_remote_device_managed"
    case .routeUpgraded: "mac_route_upgraded"
    case .huddleUsed: "mac_huddle_used"
    case .automationEdited: "mac_automation_edited"
    case .runActed: "mac_run_acted"
    case .proposalHandled: "mac_proposal_handled"
    case .memoryEdited: "mac_memory_edited"
    case .editorFileOpened: "mac_editor_file_opened"
    case .editorFileSaved: "mac_editor_file_saved"
    case .editorConflictResolved: "mac_editor_conflict_resolved"
    case .editorExternalReload: "mac_editor_external_reload"
    case .editorHighlightUnavailable: "mac_editor_highlight_unavailable"
    case .editorSearchRun: "mac_editor_search_run"
    case .editorAskAgent: "mac_editor_ask_agent"
    case .editorCompletionAccepted: "mac_editor_completion_accepted"
    case .editorCommand: "mac_editor_command"
    case .editorQuickOpenUsed: "mac_editor_quick_open_used"
    }
  }

  var properties: [String: Any] {
    switch self {
    case .launched:
      [:]
    case .quit(let hadRunningAgents):
      ["had_running_agents": hadRunningAgents]
    case .hostStarted(let restarts):
      ["restarts": restarts]
    case .hostCrashed(let exitCode, let attempt):
      ["exit_code": exitCode, "attempt": attempt]
    case .hostFailed(let crashes):
      ["crashes": crashes]
    case .hostLockConflict(let holder):
      ["holder": holder.rawValue]
    case .hostHandover(let holder, let success):
      ["holder": holder.rawValue, "success": success]
    case .hostConnected(let mode, let holder):
      ["mode": mode.rawValue, "holder": holder?.rawValue].compactMapValues { $0 }
    case .hostFeatureUnsupported(let method):
      ["method": method]
    case .screenViewed(let screen):
      ["screen": screen]
    case .linkOpened(let screen, let outcome):
      ["screen": screen, "outcome": outcome.rawValue]
    case .chatHistoryUsed(let action):
      ["action": action.rawValue]
    case .branchRenamed(let success):
      ["success": success]
    case .sidebarProjectToggled(let collapsed):
      ["collapsed": collapsed]
    case .sidebarFiltered(let kind):
      ["kind": kind.rawValue]
    case .contextCardUsed(let action):
      ["action": action.rawValue]
    case .homeCardActed(let card, let action):
      ["card": card.rawValue, "action": action.rawValue]
    case .hostFolderPicked(let stage):
      ["stage": stage.rawValue]
    case .tabUsed(let action):
      ["action": action.rawValue]
    case .sessionPanelSwitched(let panel, let via):
      ["panel": panel, "via": via.rawValue]
    case .menuCommandUsed(let action, let via):
      ["action": action.rawValue, "via": via.rawValue]
    case .menuBarUsed(let action):
      ["action": action.rawValue]
    case .menuBarToggled(let shown, let via, let serverInstalled):
      ["shown": shown, "via": via.rawValue, "server_installed": serverInstalled]
    case .loginItem(let enabled, let status):
      ["enabled": enabled, "status": status.rawValue]
    case .navigatedHistory(let direction, let via):
      ["direction": direction.rawValue, "via": via.rawValue]
    case .prefsSupplied(let keys):
      ["keys": keys]
    case .scratchPadCreated:
      [:]
    case .transcriptLinkOpened(let action, let relative):
      ["action": action.rawValue, "relative": relative]
    case .transcriptFindUsed(let matches, let navigated):
      ["matches_bucket": matches, "navigated": navigated]
    case .transcriptCopied(let span):
      ["span": span.rawValue]
    case .transcriptWorkLogOpened(let working):
      ["working": working]
    case .imageViewerUsed(let action):
      ["action": action.rawValue]
    case .messageAction(let action, let role, let success):
      ["action": action.rawValue, "role": role.rawValue, "success": success]
    case .inputUsed(let affordance):
      ["affordance": affordance]
    case .terminalUsed(let action):
      ["action": action.rawValue]
    case .terminalReplayed(let bytes, let truncated):
      ["bytes_bucket": bytes, "truncated": truncated]
    case .terminalFindUsed(let matches, let navigated):
      ["matches_bucket": matches, "navigated": navigated]
    case .runtimeTargetPicked(let platform):
      ["platform": platform]
    case .deviceWatched(let platform, let durationMs, let interacted):
      ["platform": platform, "duration_ms": durationMs, "interacted": interacted]
    case .devicePopoutOpened(let platform):
      ["platform": platform]
    case .panelToggled(let shown, let via):
      ["shown": shown, "via": via.rawValue]
    case .panelTabOpened(let kind, let via):
      ["kind": kind.rawValue, "via": via.rawValue]
    case .devicePower(let action, let platform):
      ["action": action.rawValue, "platform": platform]
    case .easSessionStartPrompted(let outcome):
      ["outcome": outcome.rawValue]
    case .browserUsed(let action):
      ["action": action.rawValue]
    case .inspectionUsed(let action, let success):
      ["action": action.rawValue, "success": success]
    case .gitUsed(let action, let scope, let remote, let success):
      ["action": action.rawValue, "scope": scope, "remote": remote, "success": success]
    case .gitRecoveryUsed(let kind, let action):
      ["kind": kind, "action": action]
    case .gitViewPicked(let view, let via):
      ["view": view, "via": via.rawValue]
    case .diffLayoutChanged(let layout, let via):
      ["layout": layout, "via": via.rawValue]
    case .hostsUsed(let action, let success):
      ["action": action.rawValue, "success": success]
    case .pullRequestActed(let action):
      ["action": action.rawValue]
    case .accountJoinActed(let action, let role):
      ["action": action.rawValue, "role": role.rawValue]
    case .accountMemberChanged(let action, let role):
      ["action": action.rawValue, "role": role.rawValue]
    case .deviceNameChanged(let source, let linked):
      ["source": source.rawValue, "linked": linked]
    case .paletteCommandRun(let section):
      ["section": section.lowercased()]
    case .handoffContinued(let matched):
      ["matched": matched]
    case .onboardingStep(let step, let skipped):
      ["step": step, "skipped": skipped]
    case .prereqFixed(let prereq, let success):
      ["prereq": prereq, "success": success]
    case .projectAdded(let source):
      ["source": source.rawValue]
    case .argusJsonGenerated(let method, let outcome):
      ["method": method.rawValue, "outcome": outcome.rawValue]
    case .projectSettingsSaved(let changed, let personal, let success):
      ["changed_bucket": changed, "personal": personal, "success": success]
    case .settingsChanged(let setting):
      ["section": setting.section.rawValue, "setting": setting.rawValue]
    case .remoteSettingChanged(let setting, let on):
      on.map { ["setting": setting.rawValue, "on": $0] } ?? ["setting": setting.rawValue]
    case .pairing(let stage, let client):
      ["stage": stage.rawValue, "client": client]
    case .remoteDeviceManaged(let action, let success):
      ["action": action.rawValue, "success": success]
    case .routeUpgraded(let from, let to):
      ["from": from.rawValue, "to": to.rawValue]
    case .huddleUsed(let action, let hasDevice):
      ["action": action.rawValue, "has_device": hasDevice]
    case .automationEdited(let action):
      ["action": action.rawValue]
    case .runActed(let action):
      ["action": action.rawValue]
    case .proposalHandled(let action):
      ["action": action.rawValue]
    case .memoryEdited(let action):
      ["action": action.rawValue]
    case .editorFileOpened(let source, let language, let sizeBucket, let readOnly):
      ["source": source.rawValue, "language": language, "size_bucket": sizeBucket, "read_only": readOnly]
    case .editorFileSaved(let formatted, let formatter, let hadConflict):
      ["formatted": formatted, "formatter": formatter.rawValue, "had_conflict": hadConflict]
    case .editorConflictResolved(let action):
      ["action": action.rawValue]
    case .editorExternalReload(let agentRunning):
      ["agent_running": agentRunning]
    case .editorHighlightUnavailable(let language, let reason):
      ["language": language, "reason": reason]
    case .editorSearchRun(let scope, let regex, let resultBucket, let truncated):
      ["scope": scope.rawValue, "regex": regex, "result_bucket": resultBucket, "truncated": truncated]
    case .editorAskAgent(let source, let startedAgent):
      ["source": source.rawValue, "started_agent": startedAgent]
    case .editorCompletionAccepted(let language):
      ["language": language]
    case .editorCommand(let command):
      ["command": command]
    case .editorQuickOpenUsed(let mode, let result):
      ["mode": mode.rawValue, "result": result.rawValue]
    }
  }

  /// A count as a bucket, never the number itself.
  static func countBucket(_ count: Int) -> String {
    switch count {
    case 0: "0"
    case 1..<10: "1-9"
    case 10..<100: "10-99"
    default: "100+"
    }
  }

  static func byteBucket(_ count: Int) -> String {
    switch count {
    case 0: "0"
    case 1..<4096: "<4k"
    case 4096..<65536: "<64k"
    default: "64k+"
    }
  }
}

extension MacTelemetryEvent.HostsAction {
  init(_ action: RemoteHostsStore.Action) {
    self = Self(rawValue: action.rawValue) ?? .attach
  }
}
