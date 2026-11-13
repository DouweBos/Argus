import ArgusCore
import Foundation

/// Where a shared route lands on the phone: a section, and the screen to open
/// in it — nil is the section's own root.
struct PhoneDestination: Equatable {
  var section: AppSection
  var route: Route?
  /// The phone has no such screen, so this is its nearest parent.
  var isFallback = false
}

/// What the sender already knows, so a title doesn't wait on a lookup.
struct RouteHints {
  var agentLabel: String?
  var repoRoot: String?
  var projectName: String?
}

extension PhoneDestination {
  /// The phone screen for a route the Mac and Electron share (`argus://` links,
  /// Handoff, the dev driver). A session lands on its session screen, an
  /// agent on the same screen with that agent's tab in front.
  @MainActor
  static func resolve(_ route: ArgusRoute, host: HostStore, hints: RouteHints = RouteHints()) async
    -> PhoneDestination
  {
    switch route {
    case .home: return PhoneDestination(section: .home)
    case .runtimes: return PhoneDestination(section: .home, isFallback: true)
    case .agents: return PhoneDestination(section: .agents)
    case .devices: return PhoneDestination(section: .devices)
    case .device(_, let key):
      await settle(host)
      if !host.devicesLoaded, host.connection == .ready { await host.refreshDevices() }
      guard let device = host.devices.first(where: { $0.id == key }) else {
        return PhoneDestination(section: .devices, isFallback: true)
      }
      return PhoneDestination(
        section: .devices,
        route: .device(id: device.id, platform: device.platform, name: device.name, isTv: device.isTv))
    case .inbox: return PhoneDestination(section: .inbox)
    case .proposal(let id): return PhoneDestination(section: .inbox, route: .proposal(id: id))
    case .pullRequests: return PhoneDestination(section: .pullRequests)
    case .pullRequest(let repo, let number):
      return PhoneDestination(section: .pullRequests, route: .pullRequest(repo: repo, number: number, label: "#\(number)"))
    case .pullRequestGuide(let repo, let number):
      return PhoneDestination(
        section: .pullRequests,
        route: .reviewGuide(target: .pullRequest(repo: repo, number: number, headSha: nil), label: "#\(number) guide"))
    case .issues(_, let issue, _):
      return PhoneDestination(section: .issues, route: issue.map { .issue(ref: $0) })
    case .design(let url, let sessionId):
      return PhoneDestination(section: .home, route: .design(url: url, sessionId: sessionId))
    case .automations: return PhoneDestination(section: .automations)
    case .quickRun(nil): return PhoneDestination(section: .automations, route: .quickRun)
    case .describeAutomation: return PhoneDestination(section: .automations, route: .describeAutomation)
    case .quickRun(let runId?), .automation(_, let runId?):
      return PhoneDestination(section: .automations, route: .run(id: runId, label: "Run"))
    case .automation(let id, nil):
      return PhoneDestination(section: .automations, route: .automation(id: id, label: "Automation"))
    case .notifications: return PhoneDestination(section: .notifications)
    case .usage: return PhoneDestination(section: .usage)
    case .usageModel(let tab, let runner, let model, let range):
      return PhoneDestination(
        section: .usage, route: .usageModel(tab: tab, runner: runner, model: model, range: range ?? .default))
    case .usagePrices: return PhoneDestination(section: .usage, route: .usagePrices)
    case .usageModels: return PhoneDestination(section: .usage, route: .usageModels)
    case .session(_, let agentId?):
      let label = host.statusByAgent[agentId].map(Labels.agentName) ?? hints.agentLabel ?? "Agent"
      return PhoneDestination(section: .home, route: .agent(id: agentId, label: label))
    case .session(let id, nil):
      guard let session = await session(id, host: host) else {
        return await sessionHome(id, host: host, hints: hints)
      }
      return PhoneDestination(
        section: .home, route: .session(id: id, label: label(session), repoRoot: session.repoRoot))
    case .sessionGit(let id, let view):
      guard let session = await session(id, host: host) else {
        return await sessionHome(id, host: host, hints: hints)
      }
      return PhoneDestination(section: .home, route: gitScreen(view, session: session))
    case .sessionCode(let id, let path, let line):
      guard let session = await session(id, host: host) else {
        return await sessionHome(id, host: host, hints: hints)
      }
      guard let path else {
        return PhoneDestination(section: .home, route: .quickOpen(sessionId: id, label: label(session)))
      }
      return PhoneDestination(section: .home, route: .file(sessionId: id, path: path, line: line, source: .link))
    }
  }

  /// A git sub-view the phone has, or the working copy beneath every one it doesn't.
  private static func gitScreen(_ view: GitRoute, session: RemoteSession) -> Route {
    let label = label(session)
    switch view {
    case .stashes, .tags: return .stashes(sessionId: session.id, label: label)
    case .history, .branches:
      return .branches(sessionId: session.id, repoRoot: session.repoRoot, label: label)
    case .compare(let left, let right) where !left.isEmpty && !right.isEmpty:
      return .branchCompare(sessionId: session.id, left: left, right: right)
    case .guide: return .reviewGuide(target: .session(id: session.id), label: "Guide")
    default: return .changes(sessionId: session.id, label: label)
    }
  }

  /// A session the phone can't find: its project, or the projects list when it has none.
  @MainActor
  private static func sessionHome(_ id: String, host: HostStore, hints: RouteHints) async -> PhoneDestination {
    let repoRoot = await session(id, host: host).flatMap { $0.isOutsideProjects ? nil : $0.repoRoot } ?? hints.repoRoot
    guard let repoRoot else { return PhoneDestination(section: .home, isFallback: true) }
    let name =
      host.projects.first { $0.repoRoot == repoRoot }?.name ?? hints.projectName
      ?? URL(fileURLWithPath: repoRoot).lastPathComponent
    return PhoneDestination(section: .home, route: .project(repoRoot: repoRoot, name: name))
  }

  /// A held session, or one fetched by id when no list the phone has carries it.
  @MainActor
  private static func session(_ id: String, host: HostStore) async -> RemoteSession? {
    if let session = host.session(id: id) { return session }
    await settle(host)
    // Sessions load per project as their screens open; a link can arrive first.
    for project in host.projects where host.sessionsByRepo[project.repoRoot] == nil {
      await host.loadSessions(repoRoot: project.repoRoot)
      if let session = host.session(id: id) { return session }
    }
    await host.adoptSession(id: id)
    return host.session(id: id)
  }

  /// A link opened at launch lands before the computer has answered; give the
  /// first project list a bounded wait rather than falling back to Home.
  @MainActor
  static func settle(_ host: HostStore, timeout: Duration = .seconds(8)) async {
    let deadline = ContinuousClock.now + timeout
    var asked = false
    while !host.projectsLoaded, ContinuousClock.now < deadline, !Task.isCancelled {
      if host.connection == .ready, !asked {
        asked = true
        await host.refreshProjects()
        continue
      }
      // A reconnect drops the first answer; ask again once it's back.
      if host.connection != .ready { asked = false }
      try? await Task.sleep(for: .milliseconds(150))
    }
  }

  private static func label(_ session: RemoteSession) -> String {
    SessionActivity.title(session)
  }
}

extension Router {
  /// Land on a resolved destination: its screen, or its section's root.
  func open(_ destination: PhoneDestination) {
    if let route = destination.route {
      open(route, in: destination.section)
    } else {
      show(destination.section)
    }
  }
}
