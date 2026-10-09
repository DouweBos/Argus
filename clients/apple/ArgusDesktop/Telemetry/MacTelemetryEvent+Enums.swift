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

  /// How a session's Home / Agents / Code / Git switch was made.
  enum PanelSwitchSource: String {
    case toolbar
    case menu
    case shortcut
    case palette
  }

  /// A keyboard command from the Agent, File or View menu.
  enum MenuCommandAction: String {
    case newAgent = "new_agent"
    case nextAgent = "next_agent"
    case previousAgent = "previous_agent"
    case selectAgent = "select_agent"
    case interruptAgent = "interrupt_agent"
    case focusComposer = "focus_composer"
    case toggleRuntime = "toggle_runtime"
    case quickSwitcher = "quick_switcher"
    case goHome = "go_home"
    case goToScreen = "go_to_screen"
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
    case view
    case resume
    case delete
    case clear
  }
}
