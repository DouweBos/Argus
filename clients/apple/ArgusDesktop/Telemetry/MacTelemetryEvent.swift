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
    /// Ignore, stop tracking, rename or move to Trash from the changes list.
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
  }

  enum PullRequestAction: String {
    case open
    case merge
    case comment
    case close
  }

  case launched
  case quit(hadRunningAgents: Bool)
  case hostStarted(restarts: Int)
  case hostCrashed(exitCode: Int, attempt: Int)
  case hostFailed(crashes: Int)
  case hostLockConflict(holder: Holder)
  case hostHandover(holder: Holder, success: Bool)
  /// `screen` is a route pattern, never an id.
  case screenViewed(screen: String)
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
  /// A git action from the git panel; `scope` is `session` or `project`.
  case gitUsed(action: GitAction, scope: String, success: Bool)
  /// A pull request was opened, merged, commented on or closed through the host's `gh`.
  case pullRequestActed(action: PullRequestAction)
  /// A command palette entry was run; `section` is its group, never its title.
  case paletteCommandRun(section: String)

  var name: String {
    switch self {
    case .launched: "mac_launched"
    case .quit: "mac_quit"
    case .hostStarted: "mac_host_started"
    case .hostCrashed: "mac_host_crashed"
    case .hostFailed: "mac_host_failed"
    case .hostLockConflict: "mac_host_lock_conflict"
    case .hostHandover: "mac_host_handover"
    case .screenViewed: "mac_screen_viewed"
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
    case .pullRequestActed: "mac_pull_request_acted"
    case .paletteCommandRun: "mac_palette_command_run"
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
    case .screenViewed(let screen):
      ["screen": screen]
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
    case .gitUsed(let action, let scope, let success):
      ["action": action.rawValue, "scope": scope, "success": success]
    case .pullRequestActed(let action):
      ["action": action.rawValue]
    case .paletteCommandRun(let section):
      ["section": section.lowercased()]
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
