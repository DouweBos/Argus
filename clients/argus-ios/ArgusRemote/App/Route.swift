import ArgusKit
import Foundation

/// Every screen the stack can push. One case per screen, carrying exactly what
/// that screen needs to load itself — so a notification tap or a deep link can
/// construct a destination without the sender knowing anything else.
enum Route: Hashable {
  case pair
  case computer(deviceId: String)
  case projects
  case project(repoRoot: String, name: String)
  case agent(id: String, label: String)
  case stoppedAgent(historyId: String, repoRoot: String, label: String, branch: String, runnerSessionId: String)
  case changes(sessionId: String, label: String)
  case branches(sessionId: String, repoRoot: String, label: String)
  case devices
  case device(id: String, platform: RemotePlatform, name: String, isTv: Bool)
  case inbox
  case automations
  case automation(id: String, label: String)
  case run(id: String, label: String)
  case settings
  case computers
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
  /// The detail column's stack, on top of the current section's own screen.
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
      detailStack = []
    case .agent(let id, let label, let repoRoot, let projectName):
      // A shortcut into the normal path, not a replacement for it: the
      // project goes underneath so back lands where it always does.
      // An agent always lives under Projects, but only write that when it
      // actually changes — an `@Observable` write invalidates on assignment,
      // not on difference.
      if section != .projects { section = .projects }
      detailStack =
        repoRoot.isEmpty
        ? [.agent(id: id, label: label)]
        : [.project(repoRoot: repoRoot, name: projectName), .agent(id: id, label: label)]
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

  func popToRoot() {
    paths[section] = []
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
