import ArgusCore
import Foundation

/// The props' enums, kept apart from the catalog so it stays readable.
extension MacTelemetryEvent {
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

  /// How a session's Agent / Code / Git switch was made.
  enum PanelSwitchSource: String {
    case card
    case menu
    case shortcut
    case palette
  }

  /// A keyboard command from the Agent, Git, File or View menu.
  enum MenuCommandAction: String {
    case newAgent = "new_agent"
    case nextAgent = "next_agent"
    case previousAgent = "previous_agent"
    case selectAgent = "select_agent"
    case interruptAgent = "interrupt_agent"
    case focusComposer = "focus_composer"
    case quickSwitcher = "quick_switcher"
    case goHome = "go_home"
    case goToScreen = "go_to_screen"
    case gitFetch = "git_fetch"
    case gitPull = "git_pull"
    case gitPush = "git_push"
    case gitBranch = "git_branch"
    case gitMerge = "git_merge"
    case gitRebase = "git_rebase"
    case gitCreatePullRequest = "git_create_pull_request"
    case gitCommit = "git_commit"
    case gitStash = "git_stash"
  }

  enum HistoryDirection: String {
    case back
    case forward
  }

  /// What moved through history: the toolbar chevrons, ⌘[ / ⌘] (or ⌃- / ⌃⇧- in
  /// the code view), a click on the Go menu item or palette entry, or a mouse's side buttons.
  enum HistorySource: String {
    case button
    case shortcut
    case menu
    case palette
    case mouse
  }

  /// Where the side panel was shown, hidden or given a tab from.
  enum PanelSource: String {
    /// The toolbar's panel button, or the panel's own close button.
    case button
    case shortcut
    case menu
    case palette
    /// The panel's "+" menu (a click or its letter key).
    case tabMenu = "tab_menu"
    /// Something that wants its output in view: a run command, a runtime's row.
    case action
  }

  /// Whether a menu command came from its key equivalent or a click.
  enum MenuCommandSource: String {
    case menu
    case shortcut
  }

  enum FolderPickStage: String {
    case opened
    case picked
    case cancelled
  }

  enum ChatHistoryAction: String {
    case search
    case view
    case resume
    case delete
    case clear
  }
}
