import ArgusCore
import ArgusUI
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
  /// One session: its agents as tabs, its tools in a details sheet.
  case session(id: String, label: String, repoRoot: String)
  /// The same screen, opened on one agent before its session is known.
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
  /// Your open Linear issues, as the desktop's `/issues`.
  case issues
  /// One Linear issue (`ENG-123`), as the desktop's `/issues/:issue`.
  case issue(ref: String)
  /// A Figma frame in the design viewer, for a session when it has one.
  case design(url: String, sessionId: String?)
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
  /// One page of Settings.
  case settingsPage(SettingsPage)
  /// Warnings and errors shown this launch, as the desktop's `/notifications`.
  case notifications
  case computers
  case account
  case addComputer
  case claudeAccounts
  case usage
  /// The phone's fifth tab: every destination without a tab of its own.
  case more

  /// The route pattern, never a project, branch, agent or device name — the
  /// Mac's `ArgusRoute.pattern` where the phone has the same screen, so one
  /// screen reads the same from either app. Phone-only screens follow its style.
  var pattern: String {
    switch self {
    case .agents: ArgusRoute.agents.pattern
    case .session, .agent: ArgusRoute.session(id: "", agentId: nil).pattern
    case .changes(let id, _): ArgusRoute.sessionGit(id: id, view: .working).pattern
    case .stashes(let id, _): ArgusRoute.sessionGit(id: id, view: .stashes).pattern
    case .branches(let id, _, _): ArgusRoute.sessionGit(id: id, view: .branches(nil)).pattern
    case .branch(let id, _, let branch): ArgusRoute.sessionGit(id: id, view: .branches(branch.name)).pattern
    case .branchCompare(let id, let left, let right):
      ArgusRoute.sessionGit(id: id, view: .compare(left: left, right: right)).pattern
    case .file(let id, let path, let line, _): ArgusRoute.sessionCode(id: id, path: path, line: line).pattern
    case .devices: ArgusRoute.devices.pattern
    case .device(let id, let platform, _, _): ArgusRoute.device(platform: platform.rawValue, deviceKey: id).pattern
    case .inbox: ArgusRoute.inbox.pattern
    case .proposal(let id): ArgusRoute.proposal(id: id).pattern
    case .pullRequests: ArgusRoute.pullRequests.pattern
    case .pullRequest(let repo, let number, _): ArgusRoute.pullRequest(repo: repo, number: number).pattern
    case .issues: ArgusRoute.issues().pattern
    case .issue(let ref): ArgusRoute.issues(issue: ref).pattern
    case .design(let url, let sessionId): ArgusRoute.design(url: url, sessionId: sessionId).pattern
    case .automations: ArgusRoute.automations.pattern
    case .automation(let id, _): ArgusRoute.automation(id: id, runId: nil).pattern
    case .quickRun: ArgusRoute.quickRun(runId: nil).pattern
    case .run(let id, _): ArgusRoute.automation(id: "", runId: id).pattern
    case .notifications: ArgusRoute.notifications.pattern
    case .usage: ArgusRoute.usage(.limits).pattern
    case .projects: ArgusRoute.home.pattern
    case .project: "/projects/:repoRoot"
    case .stoppedAgent: "/projects/:repoRoot/stopped-agents/:historyId"
    case .quickOpen: "/sessions/:sessionId/code/quick-open"
    case .fileSearch: "/sessions/:sessionId/code/search"
    case .terminals: "/sessions/:sessionId/terminals"
    case .terminal: "/terminals/:terminalId"
    case .commit: "/sessions/:sessionId/git/commits/:hash"
    case .automationEditor(let id, _): id == nil ? "/automations/new" : "/automations/:automationId/edit"
    case .describeAutomation: "/automations/describe"
    case .automationDraft: "/automations/draft"
    case .pair: "/pair"
    case .settings: "/settings"
    case .settingsPage(let page): "/settings/\(page.rawValue.replacingOccurrences(of: "_", with: "-"))"
    case .computers: "/settings/computers"
    case .computer: "/settings/computers/:deviceId"
    case .addComputer: "/settings/computers/new"
    case .account: "/settings/account"
    case .claudeAccounts: "/settings/claude-accounts"
    case .more: "/more"
    }
  }
}

/// The top-level destinations, as the Mac's sidebar lists them. A phone has
/// room for five tabs, so the rest live under More; an iPad's sidebar lists
/// them all.
enum AppSection: String, Hashable, CaseIterable, Identifiable {
  case home, inbox, agents, devices, automations, issues, pullRequests, usage, notifications, settings, more

  var id: String { rawValue }

  /// The phone's tab bar.
  static let tabs: [AppSection] = [.home, .inbox, .agents, .automations, .more]
  /// The iPad sidebar's everyday rows, then the occasional ones — the Mac's
  /// primary list and its foot. Issues only shows with Linear connected.
  static let primary: [AppSection] = [.home, .inbox, .agents, .devices, .automations, .issues]
  static let secondary: [AppSection] = [.pullRequests, .usage, .notifications, .settings]
  /// What More lists, in order.
  static let underMore: [AppSection] = [.pullRequests, .issues, .devices, .usage, .notifications, .settings]

  /// Where this section lives on a phone: its own tab, or More.
  var tab: AppSection { Self.tabs.contains(self) ? self : .more }

  /// The screen at the section's root.
  var root: Route {
    switch self {
    case .home: .projects
    case .inbox: .inbox
    case .agents: .agents
    case .devices: .devices
    case .automations: .automations
    case .issues: .issues
    case .pullRequests: .pullRequests
    case .usage: .usage
    case .notifications: .notifications
    case .settings: .settings
    case .more: .more
    }
  }

  var title: String {
    switch self {
    case .home: "Home"
    case .inbox: "Inbox"
    case .agents: "Agents"
    case .devices: "Devices"
    case .automations: "Automations"
    case .issues: "Issues"
    case .pullRequests: "Pull Requests"
    case .usage: "Usage"
    case .notifications: "Notifications"
    case .settings: "Settings"
    case .more: "More"
    }
  }

  var symbol: String {
    switch self {
    case .home: Icon.home
    case .inbox: Icon.inbox
    case .agents: Icon.agents
    case .devices: Icon.devices
    case .automations: Icon.automations
    case .issues: Icon.issues
    case .pullRequests: Icon.pullRequests
    case .usage: Icon.usage
    case .notifications: Icon.notifications
    case .settings: Icon.settings
    case .more: Icon.more
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
  case session(id: String, label: String, repoRoot: String, projectName: String)

  /// Identity is the session id alone — the surrounding detail is there to
  /// build the path, not to tell two selections apart. Without this, a
  /// selection made from the sidebar wouldn't match one made by navigating.
  static func == (lhs: SidebarItem, rhs: SidebarItem) -> Bool {
    switch (lhs, rhs) {
    case (.section(let a), .section(let b)): a == b
    case (.session(let a, _, _, _), .session(let b, _, _, _)): a == b
    default: false
    }
  }

  func hash(into hasher: inout Hasher) {
    switch self {
    case .section(let section):
      hasher.combine(0)
      hasher.combine(section)
    case .session(let id, _, _, _):
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
  var section: AppSection = .home
  /// One stack per section, used on a phone and in the middle column.
  var paths: [AppSection: [Route]] = [:]

  /// True wherever there is room for a sidebar beside the content.
  var isSplit = false
  /// The sidebar's selection, and which projects are folded shut in it.
  var sidebarSelection: SidebarItem? = .section(.home)
  var collapsedProjects: Set<String> = []
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
    if case .session(let id, let label, let repoRoot) = route {
      // Equality is by id, so the empty project name still matches the
      // sidebar's own entry and keeps its row highlighted.
      sidebarSelection = .session(id: id, label: label, repoRoot: repoRoot, projectName: "")
    }
  }

  /// Open a section at its root. On a phone one without a tab opens inside
  /// More, so back lands on More's list.
  func show(_ section: AppSection) {
    guard !isSplit else {
      apply(.section(section))
      return
    }
    let tab = section.tab
    self.section = tab
    paths[tab] = tab == section ? [] : [section.root]
  }

  /// Apply a sidebar selection: a section swaps what the detail column shows,
  /// a session opens in it.
  func apply(_ item: SidebarItem?) {
    guard let item else { return }
    switch item {
    case .section(let section):
      if self.section != section { self.section = section }
      detailProject = nil
      detailStack = []
    case .session(let id, let label, let repoRoot, let projectName):
      // A shortcut into the normal path, not a replacement for it: the
      // project goes underneath so back lands where it always does.
      // A session always lives under Home, but only write that when it
      // actually changes — an `@Observable` write invalidates on assignment,
      // not on difference.
      if section != .home { section = .home }
      // Root the column on the project and push only the session. Assigning a
      // two-element path in one update loses the second push; one push
      // against a stable root does not.
      let project = repoRoot.isEmpty ? nil : ProjectRef(repoRoot: repoRoot, name: projectName)
      let opened = Route.session(id: id, label: label, repoRoot: repoRoot)
      guard detailProject != project else {
        // Same project already rooting the column: nothing about the root
        // changes, so the push lands on its own.
        detailStack = [opened]
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
        self.detailStack = [opened]
      }
    }
    sidebarSelection = item
  }

  /// Carry open destinations across a rotation or a Split View resize.
  ///
  /// A phone's More tab has no sidebar row: its first screen becomes the
  /// section on the way to an iPad, and goes back under More on the way back.
  func adopt(split: Bool) {
    guard split != isSplit else { return }
    if split {
      var stack = paths[section] ?? []
      paths[section] = []
      if section == .more, let first = stack.first,
        let owner = AppSection.underMore.first(where: { $0.root == first })
      {
        section = owner
        stack.removeFirst()
      }
      detailStack = stack
      sidebarSelection = .section(section)
    } else {
      let tab = section.tab
      paths[tab] = (tab == section ? [] : [section.root]) + detailStack
      section = tab
      detailStack = []
    }
    isSplit = split
  }

  /// Switch section and open something — used by a notification tap.
  func open(_ route: Route, in section: AppSection) {
    guard route != section.root else {
      show(section)
      return
    }
    if isSplit {
      self.section = section
      detailProject = nil
      detailStack = [route]
      if case .session(let id, let label, let repoRoot) = route {
        sidebarSelection = .session(id: id, label: label, repoRoot: repoRoot, projectName: "")
      } else {
        sidebarSelection = .section(section)
      }
    } else {
      let tab = section.tab
      self.section = tab
      paths[tab] = (tab == section ? [] : [section.root]) + [route]
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

extension Route {
  /// What a start sheet lands on: the agent, or a new worktree's session,
  /// whose agent joins as a tab once setup finishes.
  init(_ started: StartAgentSheet.Started) {
    switch started {
    case .agent(let agent):
      self = .agent(id: agent.agentId, label: Labels.agentName(agent))
    case .session(let session):
      self = .session(id: session.id, label: SessionActivity.title(session), repoRoot: session.repoRoot)
    }
  }
}
