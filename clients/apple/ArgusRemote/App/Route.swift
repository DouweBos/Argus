import ArgusCore
import Foundation

/// Every screen the stack can push. One case per screen, carrying exactly what
/// that screen needs to load itself — so a notification tap or a deep link can
/// construct a destination without the sender knowing anything else.
enum Route: Hashable {
  case pair
  case computer(deviceId: String)
  case projects
  /// Every agent across projects, as the desktop's `/agents`.
  case agents
  case project(repoRoot: String, name: String)
  case agent(id: String, label: String)
  case stoppedAgent(historyId: String, repoRoot: String, label: String, branch: String, runnerSessionId: String)
  case changes(sessionId: String, label: String)
  /// One session file, read-only. `path` may be absolute; `line` is 1-based.
  case file(sessionId: String, path: String, line: Int?, source: FileViewSource)
  /// Fuzzy file finder over a session's worktree.
  case quickOpen(sessionId: String, label: String)
  /// Text search across a session's worktree.
  case fileSearch(sessionId: String, label: String)
  /// A session's terminals, read-only.
  case terminals(sessionId: String, label: String)
  case terminal(id: String, label: String)
  /// A session's stashes and tags.
  case stashes(sessionId: String, label: String)
  case branches(sessionId: String, repoRoot: String, label: String)
  case branch(sessionId: String, repoRoot: String, branch: RemoteGitBranch)
  case commit(sessionId: String, hash: String, subject: String)
  case branchCompare(sessionId: String, left: String, right: String)
  case devices
  case device(id: String, platform: RemotePlatform, name: String, isTv: Bool)
  case inbox
  /// One proposal in full, as the desktop's `/inbox/proposals/:proposalId`.
  case proposal(id: String)
  case pullRequests
  case pullRequest(repo: String, number: Int, label: String)
  case automations
  case automation(id: String, label: String)
  case quickRun
  /// Nil id creates a new automation.
  case automationEditor(id: String?, label: String)
  /// "Describe it", and the draft it produced, reviewed in the editor.
  case describeAutomation
  case automationDraft(detail: RemoteAutomationDetail, notes: [String])
  case run(id: String, label: String)
  case settings
  /// Warnings & errors shown this launch, as the desktop's `/notifications`.
  case notifications
  case computers
  case claudeAccounts
  case usage

  /// The pattern only — never a project, branch, agent or device name. The
  /// desktop's `routePattern()` does the same thing for the same reason: a
  /// screen name is useful, the thing being looked at is not ours to send.
  var telemetryName: String {
    switch self {
    case .pair: "pair"
    case .computer: "computer"
    case .projects: "projects"
    case .agents: "agents"
    case .project: "project"
    case .agent: "agent"
    case .stoppedAgent: "stopped_agent"
    case .changes: "changes"
    case .file: "file"
    case .quickOpen: "quick_open"
    case .fileSearch: "file_search"
    case .terminals: "terminals"
    case .terminal: "terminal"
    case .stashes: "stashes"
    case .branches: "branches"
    case .branch: "branch"
    case .commit: "commit"
    case .branchCompare: "branch_compare"
    case .devices: "devices"
    case .device: "device"
    case .inbox: "inbox"
    case .proposal: "proposal"
    case .pullRequests: "pull_requests"
    case .pullRequest: "pull_request"
    case .automations: "automations"
    case .automation: "automation"
    case .quickRun: "quick_run"
    case .automationEditor: "automation_editor"
    case .describeAutomation: "describe_automation"
    case .automationDraft: "automation_draft"
    case .run: "run"
    case .settings: "settings"
    case .notifications: "notifications"
    case .computers: "computers"
    case .claudeAccounts: "claude_accounts"
    case .usage: "usage"
    }
  }
}

/// The top-level sections. These are tabs on a phone and a sidebar on an
/// iPad — one `TabView` with `.sidebarAdaptable` gives both, so there is no
/// separate split-view hierarchy to keep in step.
enum AppSection: String, Hashable, CaseIterable, Identifiable {
  case projects, inbox, automations, devices, settings

  var id: String { rawValue }

  var title: String {
    switch self {
    case .projects: "Projects"
    case .inbox: "Inbox"
    case .automations: "Automations"
    case .devices: "Devices"
    case .settings: "Settings"
    }
  }

  var symbol: String {
    switch self {
    case .projects: "folder"
    case .inbox: "tray"
    case .automations: "clock"
    case .devices: "iphone"
    case .settings: "gearshape"
    }
  }
}

/// What the iPad sidebar can have selected: a section, or something inside
/// one. Selection drives the detail column, which is what a `NavigationLink`
/// cannot do across columns — it only ever pushes onto its own stack.
struct ProjectRef: Hashable {
  var repoRoot: String
  var name: String
}

enum SidebarItem: Hashable {
  case section(AppSection)
  /// Carries its project so selecting it can seed the same stack the user
  /// would have built by hand.
  case agent(id: String, label: String, repoRoot: String, projectName: String)

  /// Identity is the agent id alone — the surrounding detail is there to
  /// build the path, not to tell two selections apart. Without this, a
  /// selection made from the sidebar wouldn't match one made by navigating.
  static func == (lhs: SidebarItem, rhs: SidebarItem) -> Bool {
    switch (lhs, rhs) {
    case (.section(let a), .section(let b)): a == b
    case (.agent(let a, _, _, _), .agent(let b, _, _, _)): a == b
    default: false
    }
  }

  func hash(into hasher: inout Hasher) {
    switch self {
    case .section(let section):
      hasher.combine(0)
      hasher.combine(section)
    case .agent(let id, _, _, _):
      hasher.combine(1)
      hasher.combine(id)
    }
  }
}

/// Navigation state, owned by the root so a notification can drive it from
/// outside the view tree. Each section keeps its own stack, which is what a
/// `TabView` expects and what users expect when switching back to a tab.
@MainActor
@Observable
final class Router {
  var section: AppSection = .projects
  /// One stack per section, used on a phone and in the middle column.
  var paths: [AppSection: [Route]] = [:]

  /// True wherever there is room for a sidebar beside the content.
  var isSplit = false
  /// The sidebar's selection, and which project groups are open in it.
  var sidebarSelection: SidebarItem? = .section(.projects)
  var expandedProjects: Set<String> = []
  /// When set, the detail column is rooted on this project instead of the
  /// section's own screen — so an agent opened from the sidebar has its
  /// project behind it without needing a second entry in the path.
  var detailProject: ProjectRef?

  /// The detail column's stack, on top of whatever roots it.
  ///
  /// One array, not a root plus a stack: swapping the root view changes its
  /// identity, which re-creates the `NavigationStack` and throws away a path
  /// set in the same update — so seeding a path underneath never arrived.
  var detailStack: [Route] = []


  func path(for section: AppSection) -> [Route] { paths[section] ?? [] }

  func push(_ route: Route) {
    guard isSplit else {
      paths[section, default: []].append(route)
      return
    }
    detailStack.append(route)
    if case .agent(let id, let label) = route {
      // Equality is by id, so the empty project fields still match the
      // sidebar's own entry and keep its row highlighted.
      sidebarSelection = .agent(id: id, label: label, repoRoot: "", projectName: "")
    }
  }

  /// Opening a section fresh clears whatever the detail column was showing —
  /// an agent from one project has no business sitting beside another.
  func select(_ section: AppSection) {
    guard section != self.section else { return }
    self.section = section
    detailStack = []
  }

  /// Apply a sidebar selection: a section swaps what the detail column shows,
  /// an agent opens in it.
  func apply(_ item: SidebarItem?) {
    guard let item else { return }
    switch item {
    case .section(let section):
      if self.section != section { self.section = section }
      detailProject = nil
      detailStack = []
    case .agent(let id, let label, let repoRoot, let projectName):
      // A shortcut into the normal path, not a replacement for it: the
      // project goes underneath so back lands where it always does.
      // An agent always lives under Projects, but only write that when it
      // actually changes — an `@Observable` write invalidates on assignment,
      // not on difference.
      if section != .projects { section = .projects }
      // Root the column on the project and push only the agent. Assigning a
      // two-element path in one update loses the second push; one push
      // against a stable root does not.
      let project = repoRoot.isEmpty ? nil : ProjectRef(repoRoot: repoRoot, name: projectName)
      let agent = Route.agent(id: id, label: label)
      guard detailProject != project else {
        // Same project already rooting the column: nothing about the root
        // changes, so the push lands on its own.
        detailStack = [agent]
        break
      }
      // Changing what roots the column and pushing onto it in the same
      // update loses the push — SwiftUI rebuilds the stack around the new
      // root first. Let the root land, then push. This is exactly the second
      // tap the user was having to make.
      detailProject = project
      detailStack = []
      Task { @MainActor [weak self] in
        guard let self, self.detailProject == project, self.detailStack.isEmpty else { return }
        self.detailStack = [agent]
      }
    }
    sidebarSelection = item
  }

  /// Carry open destinations across a rotation or a Split View resize.
  func adopt(split: Bool) {
    guard split != isSplit else { return }
    if split {
      detailStack = paths[section] ?? []
      paths[section] = []
    } else {
      paths[section] = detailStack
      detailStack = []
    }
    isSplit = split
  }

  /// Switch section and open something — used by a notification tap.
  func open(_ route: Route, in section: AppSection) {
    self.section = section
    if isSplit {
      detailStack = [route]
    } else {
      paths[section] = [route]
    }
  }

  func pop() {
    if isSplit {
      _ = detailStack.popLast()
    } else {
      _ = paths[section]?.popLast()
    }
  }

  /// Swap the top `dropping` screens for one, so back skips a finished flow.
  func replaceTop(with route: Route, dropping count: Int) {
    if isSplit {
      detailStack.removeLast(min(count, detailStack.count))
      detailStack.append(route)
    } else {
      var path = paths[section] ?? []
      path.removeLast(min(count, path.count))
      path.append(route)
      paths[section] = path
    }
  }

  func popToRoot() {
    paths[section] = []
    detailProject = nil
    detailStack = []
  }

  /// True when that agent is already the top of the current stack, so a
  /// repeated notification doesn't stack a second copy of it.
  func isShowingAgent(_ agentId: String) -> Bool {
    let top = isSplit ? detailStack.last : paths[section]?.last
    if case .agent(let id, _) = top { return id == agentId }
    return false
  }
}
