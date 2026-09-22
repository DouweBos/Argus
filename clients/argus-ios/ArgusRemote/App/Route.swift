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

extension Route {
  /// Which column a route belongs to when there are three.
  ///
  /// The middle column continues the browsing hierarchy, so it keeps a
  /// project's sessions and agents on screen while you read one of them.
  /// Everything you actually read or drive lands in the detail column.
  var isDetail: Bool {
    switch self {
    case .project, .computers, .pair:
      false
    default:
      true
    }
  }

  /// Secondary detail routes stack on top of what is already open, so an
  /// agent's changes get a back button rather than replacing the agent.
  var stacksOnDetail: Bool {
    switch self {
    case .changes, .branches:
      true
    default:
      false
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
enum SidebarItem: Hashable {
  case section(AppSection)
  case agent(id: String, label: String)
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
  /// The detail column's root, and anything stacked on it.
  var detailRoot: Route?
  var detailStack: [Route] = []


  func path(for section: AppSection) -> [Route] { paths[section] ?? [] }

  func push(_ route: Route) {
    guard isSplit, route.isDetail else {
      paths[section, default: []].append(route)
      return
    }
    if route.stacksOnDetail, detailRoot != nil {
      detailStack.append(route)
    } else {
      detailRoot = route
      detailStack = []
      if case .agent(let id, let label) = route {
        sidebarSelection = .agent(id: id, label: label)
      }
    }
  }

  /// Opening a section fresh clears whatever the detail column was showing —
  /// an agent from one project has no business sitting beside another.
  func select(_ section: AppSection) {
    guard section != self.section else { return }
    self.section = section
    detailRoot = nil
    detailStack = []
  }

  /// Apply a sidebar selection: a section swaps what the detail column shows,
  /// an agent opens in it.
  func apply(_ item: SidebarItem?) {
    guard let item else { return }
    switch item {
    case .section(let section):
      self.section = section
      detailRoot = nil
      detailStack = []
    case .agent(let id, let label):
      detailRoot = .agent(id: id, label: label)
      detailStack = []
    }
    sidebarSelection = item
  }

  /// Carry open destinations across a rotation or a Split View resize.
  func adopt(split: Bool) {
    guard split != isSplit else { return }
    let stack = paths[section] ?? []
    if split {
      paths[section] = stack.filter { !$0.isDetail }
      let detail = stack.filter(\.isDetail)
      detailRoot = detail.first
      detailStack = Array(detail.dropFirst())
    } else {
      paths[section] = stack + (detailRoot.map { [$0] } ?? []) + detailStack
      detailRoot = nil
      detailStack = []
    }
    isSplit = split
  }

  /// Switch section and open something — used by a notification tap.
  func open(_ route: Route, in section: AppSection) {
    self.section = section
    if isSplit, route.isDetail {
      detailRoot = route
      detailStack = []
    } else {
      paths[section] = [route]
    }
  }

  func popToRoot() {
    paths[section] = []
    detailRoot = nil
    detailStack = []
  }

  /// True when that agent is already the top of the current stack, so a
  /// repeated notification doesn't stack a second copy of it.
  func isShowingAgent(_ agentId: String) -> Bool {
    let top = isSplit ? (detailStack.last ?? detailRoot) : paths[section]?.last
    if case .agent(let id, _) = top { return id == agentId }
    return false
  }
}
