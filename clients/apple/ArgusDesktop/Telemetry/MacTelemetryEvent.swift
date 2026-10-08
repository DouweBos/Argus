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
    case reveal
    case copyPath = "copy_path"
    case openUrl = "open_url"
    case copyLink = "copy_link"
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

  enum PullRequestAction: String {
    case open
    case merge
    case comment
    case close
  }

  enum ProjectSource: String {
    case openPanel = "open_panel"
    case example
    case recent
  }

  enum ArgusJsonMethod: String {
    case quick
    case claude
  }

  enum ArgusJsonOutcome: String {
    case saved
    case discarded
    case failed
  }

  enum RemoteSetting: String {
    case enabled
    case tailscale
    case cloudflare
    case tunnelMode = "tunnel_mode"
    case tunnelToken = "tunnel_token"
    case publicUrl = "public_url"
    case notifyWhenFocused = "notify_when_focused"
    case push
    case pushContact = "push_contact"
  }

  enum PairingStage: String {
    case started
    case confirmed
    case completed
    case cancelled
    case failed
  }

  enum RemoteDeviceAction: String {
    case grants
    case revoke
    case testPush = "test_push"
  }

  enum HuddleAction: String {
    case start
    case blocked
    case stop
    case approve
    case deny
    case remove
    case say
    case copyInvite = "copy_invite"
  }

  enum LinkOutcome: String {
    /// Its screen was there to open.
    case direct
    /// It named a session whose host connected later.
    case waited
    /// Its session never turned up.
    case abandoned
  }

  enum HomeCard: String {
    case notifications
    case recentProject = "recent_project"
    case legacySecrets = "legacy_secrets"
  }

  enum HomeCardAction: String {
    case open
    case dismiss
    case fixed
    case failed
  }

  enum TabAction: String {
    case open
    case close
    case `switch`
  }

  /// How a session's Home / Agents / Git switch was made.
  enum PanelSwitchSource: String {
    case toolbar
    case menu
    case shortcut
  }

  enum FolderPickStage: String {
    case opened
    case picked
    case cancelled
  }

  enum ChatHistoryAction: String {
    case view
    case resume
    case delete
    case clear
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
  /// A session's Home, Agents or Git panel was picked from the toolbar or the View menu.
  case sessionPanelSwitched(panel: String, via: PanelSwitchSource)
  /// A folder was browsed for on a paired host's disk.
  case hostFolderPicked(stage: FolderPickStage)
  /// A session's branch was renamed from its home.
  case branchRenamed(success: Bool)
  /// A deep link or launch route was opened; `screen` is its route pattern.
  case linkOpened(screen: String, outcome: LinkOutcome)
  /// A transcript link was used; `relative` is whether the path needed the worktree.
  case transcriptLinkOpened(action: LinkAction, relative: Bool)
  /// Find in chat was closed after a search. Counts are bucketed, never the query.
  case transcriptFindUsed(matches: String, navigated: Bool)
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
  case devicePower(action: PowerAction, platform: String)
  case browserUsed(action: BrowserAction)
  case inspectionUsed(action: InspectionAction, success: Bool)
  /// A git action from the git panel; `scope` is `session` or `project`,
  /// `remote` when the session is on a paired host.
  case gitUsed(action: GitAction, scope: String, remote: Bool, success: Bool)
  /// A fix was picked from a git error banner; `kind` and `action` are the banner's enums.
  case gitRecoveryUsed(kind: String, action: String)
  /// Diffs switched between unified and split, from a diff's header or Settings.
  case diffLayoutChanged(layout: String, via: DiffLayoutSetting.Source)
  /// Another host was paired, attached, detached, forgotten, renamed or shown.
  case hostsUsed(action: HostsAction, success: Bool)
  /// A pull request was opened, merged, commented on or closed through the host's `gh`.
  case pullRequestActed(action: PullRequestAction)
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
  /// The Tailscale checklist ran a check or a one-click fix.
  case tailscaleChecked(fix: Bool, ready: Bool)
  /// Something done to a huddle from its sheet, chat or join requests.
  case huddleUsed(action: HuddleAction, hasDevice: Bool)
  case automationEdited(action: StoreEvent.AutomationAction)
  case runActed(action: StoreEvent.RunAction)
  case proposalHandled(action: StoreEvent.ProposalAction)
  case memoryEdited(action: StoreEvent.MemoryAction)

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
    case .screenViewed: "mac_screen_viewed"
    case .linkOpened: "mac_link_opened"
    case .chatHistoryUsed: "mac_chat_history_used"
    case .branchRenamed: "mac_branch_renamed"
    case .homeCardActed: "mac_home_card_acted"
    case .hostFolderPicked: "mac_host_folder_picked"
    case .tabUsed: "mac_tab_used"
    case .sessionPanelSwitched: "mac_session_panel_switched"
    case .scratchPadCreated: "mac_scratch_pad_created"
    case .prefsSupplied: "mac_prefs_supplied"
    case .transcriptLinkOpened: "mac_transcript_link_opened"
    case .transcriptFindUsed: "mac_transcript_find_used"
    case .inputUsed: "mac_input_used"
    case .terminalUsed: "mac_terminal_used"
    case .terminalReplayed: "mac_terminal_replayed"
    case .terminalFindUsed: "mac_terminal_find_used"
    case .runtimeTargetPicked: "mac_runtime_target_picked"
    case .deviceWatched: "mac_device_watched"
    case .devicePopoutOpened: "mac_device_popout_opened"
    case .devicePower: "mac_device_power"
    case .browserUsed: "mac_browser_used"
    case .inspectionUsed: "mac_inspection_used"
    case .gitUsed: "mac_git_used"
    case .gitRecoveryUsed: "mac_git_recovery_used"
    case .diffLayoutChanged: "mac_diff_layout_changed"
    case .hostsUsed: "mac_hosts_used"
    case .pullRequestActed: "mac_pull_request_acted"
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
    case .tailscaleChecked: "mac_tailscale_checked"
    case .huddleUsed: "mac_huddle_used"
    case .automationEdited: "mac_automation_edited"
    case .runActed: "mac_run_acted"
    case .proposalHandled: "mac_proposal_handled"
    case .memoryEdited: "mac_memory_edited"
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
    case .screenViewed(let screen):
      ["screen": screen]
    case .linkOpened(let screen, let outcome):
      ["screen": screen, "outcome": outcome.rawValue]
    case .chatHistoryUsed(let action):
      ["action": action.rawValue]
    case .branchRenamed(let success):
      ["success": success]
    case .homeCardActed(let card, let action):
      ["card": card.rawValue, "action": action.rawValue]
    case .hostFolderPicked(let stage):
      ["stage": stage.rawValue]
    case .tabUsed(let action):
      ["action": action.rawValue]
    case .sessionPanelSwitched(let panel, let via):
      ["panel": panel, "via": via.rawValue]
    case .prefsSupplied(let keys):
      ["keys": keys]
    case .scratchPadCreated:
      [:]
    case .transcriptLinkOpened(let action, let relative):
      ["action": action.rawValue, "relative": relative]
    case .transcriptFindUsed(let matches, let navigated):
      ["matches_bucket": matches, "navigated": navigated]
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
    case .devicePower(let action, let platform):
      ["action": action.rawValue, "platform": platform]
    case .browserUsed(let action):
      ["action": action.rawValue]
    case .inspectionUsed(let action, let success):
      ["action": action.rawValue, "success": success]
    case .gitUsed(let action, let scope, let remote, let success):
      ["action": action.rawValue, "scope": scope, "remote": remote, "success": success]
    case .gitRecoveryUsed(let kind, let action):
      ["kind": kind, "action": action]
    case .diffLayoutChanged(let layout, let via):
      ["layout": layout, "via": via.rawValue]
    case .hostsUsed(let action, let success):
      ["action": action.rawValue, "success": success]
    case .pullRequestActed(let action):
      ["action": action.rawValue]
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
    case .tailscaleChecked(let fix, let ready):
      ["fix": fix, "ready": ready]
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
