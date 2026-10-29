import ArgusKit
import Foundation
import Observation

/// The Issues screen's list of Linear issues for one scope, or for a search
/// of the whole workspace. Shared by the Mac's board and the phone's list, so
/// a change made in an issue's detail shows on both without asking Linear again.
@MainActor
@Observable
public final class LinearIssuesModel {
  public var scope: ArgusProtocol.LinearIssueScope = .assigned {
    didSet {
      guard scope != oldValue else { return }
      issues = nil
      error = nil
    }
  }
  /// A search of the whole workspace, which wins over `scope`; nil lists the scope. Set it to a `term`.
  public var query: String? {
    didSet {
      guard query != oldValue else { return }
      issues = nil
      error = nil
      reported = false
    }
  }
  /// Nil until the first answer for this scope or search.
  public private(set) var issues: [ArgusProtocol.LinearIssue]?
  /// The first answer to each search, with how many it found: once per search, never per refresh.
  public var onSearched: ((Int) -> Void)?
  /// The scope's active filters, like a saved Linear view; remembered per scope, and once for search.
  public var filters: [IssueFilter] {
    get { filtersByScope[filterKey] ?? [] }
    set {
      filtersByScope[filterKey] = newValue
      Self.save(filtersByScope, to: defaults)
    }
  }

  private var filterKey: String { query == nil ? scope.rawValue : Self.searchFilterKey }

  /// `issues` after the filters: what the board and list show.
  public var shownIssues: [ArgusProtocol.LinearIssue]? {
    issues.map { IssueFilters.apply($0, filters) }
  }
  public private(set) var error: String?
  public private(set) var refreshing = false

  /// Every workflow state of the issues' teams, so the board can offer columns no issue is in yet.
  public var workflowStates: [ArgusProtocol.LinearWorkflowState] {
    Set((issues ?? []).map(\.teamId)).sorted().flatMap { statesByTeam[$0] ?? [] }
  }

  private var reported = false
  private var statesByTeam: [String: [ArgusProtocol.LinearWorkflowState]] = [:]
  private var filtersByScope: [String: [IssueFilter]]
  private let defaults: UserDefaults?
  private unowned let host: HostStore

  /// `defaults` nil keeps filters in memory only.
  public init(host: HostStore, defaults: UserDefaults? = .standard) {
    self.host = host
    self.defaults = defaults
    filtersByScope = Self.load(from: defaults)
  }

  static let filtersKey = "issues.filters"
  static let searchFilterKey = "search"
  /// A search asks for fewer than a scope: Linear ranks them, so the top ones are what's wanted.
  public nonisolated static let searchLimit = 50

  /// What's worth searching for: trimmed, nil when nothing is left.
  public nonisolated static func term(_ raw: String?) -> String? {
    guard let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else { return nil }
    return trimmed
  }
  /// The Mac's old Current cycle toggle, carried over into a filter once.
  static let legacyCycleKey = "issues.currentCycle"

  static func load(from defaults: UserDefaults?) -> [String: [IssueFilter]] {
    guard let defaults else { return [:] }
    var saved =
      defaults.data(forKey: filtersKey).flatMap { try? JSONDecoder().decode([String: [IssueFilter]].self, from: $0) }
      ?? [:]
    if defaults.object(forKey: legacyCycleKey) != nil {
      if defaults.bool(forKey: legacyCycleKey), saved[ArgusProtocol.LinearIssueScope.assigned.rawValue] == nil {
        saved[ArgusProtocol.LinearIssueScope.assigned.rawValue] = [IssueFilters.currentCycle]
        save(saved, to: defaults)
      }
      defaults.removeObject(forKey: legacyCycleKey)
    }
    return saved
  }

  static func save(_ filters: [String: [IssueFilter]], to defaults: UserDefaults?) {
    guard let defaults, let data = try? JSONEncoder().encode(filters) else { return }
    defaults.set(data, forKey: filtersKey)
  }

  public func refresh() async {
    guard host.linearConnected else {
      issues = nil
      error = nil
      return
    }
    let asked = (scope: scope, query: query)
    func current() -> Bool { asked.scope == scope && asked.query == query }
    refreshing = true
    defer { refreshing = false }
    do {
      let found =
        if let term = asked.query {
          try await host.linearIssues(query: term, limit: Self.searchLimit)
        } else {
          try await host.linearIssues(query: "", scope: asked.scope, limit: 100)
        }
      guard current() else { return }
      issues = found
      error = nil
      if asked.query != nil, !reported {
        reported = true
        onSearched?(found.count)
      }
    } catch {
      guard current() else { return }
      self.error = HostStore.describe(error)
    }
    await loadWorkflowStates()
    // "Agent on it" needs every project's sessions, not just the ones opened.
    for project in host.projects {
      await host.loadSessions(repoRoot: project.repoRoot)
    }
  }

  /// Once per team: workflows rarely change, and a failure just leaves the board to the issues' own states.
  private func loadWorkflowStates() async {
    let teams = Set((issues ?? []).map(\.teamId)).subtracting(statesByTeam.keys)
    for team in teams.sorted() {
      if let states = try? await host.linearTeamStates(teamId: team), !states.isEmpty {
        statesByTeam[team] = states
      }
    }
  }

  /// An issue as it now stands, after a change made from its detail.
  public func replace(_ issue: ArgusProtocol.LinearIssue) {
    guard let index = issues?.firstIndex(where: { $0.id == issue.id }) else { return }
    issues?[index] = issue
  }
}

/// One issue in full, and the changes you can make to it as the computer's
/// connected Linear user: status, priority and a comment.
@MainActor
@Observable
public final class LinearIssueDetailModel {
  public let ref: String
  public private(set) var issue: ArgusProtocol.LinearIssueDetail?
  /// Its team's workflow, for the status picker; empty until known.
  public private(set) var states: [ArgusProtocol.LinearWorkflowState] = []
  public private(set) var loadError: String?
  /// The last change that failed.
  public var actionError: String?
  public private(set) var updating = false
  public private(set) var posting = false
  /// The thread a reply is being posted in; nil for a new comment.
  public private(set) var postingIn: String?

  private unowned let host: HostStore
  private let onChange: (ArgusProtocol.LinearIssue) -> Void

  public init(ref: String, host: HostStore, onChange: @escaping (ArgusProtocol.LinearIssue) -> Void = { _ in }) {
    self.ref = ref
    self.host = host
    self.onChange = onChange
  }

  /// The picker's options: the workflow, or just the issue's own state until it loads.
  public var stateOptions: [ArgusProtocol.LinearWorkflowState] {
    if !states.isEmpty { return states.sorted { $0.position < $1.position } }
    return issue.map { [$0.state] } ?? []
  }

  public func load() async {
    do {
      let found = try await host.linearIssue(ref: ref)
      issue = found.issue
      if !found.states.isEmpty { states = found.states }
      loadError = found.issue == nil ? "Linear has no issue \(ref)." : nil
    } catch {
      loadError = HostStore.describe(error)
    }
  }

  public func setState(_ stateId: String) async {
    guard let current = issue, current.state.id != stateId else { return }
    if let state = states.first(where: { $0.id == stateId }) { issue?.state = state }
    await update(stateId: stateId, priority: nil, revert: current)
  }

  public func setPriority(_ priority: Int) async {
    guard let current = issue, Int(current.priority) != priority else { return }
    issue?.priority = Double(priority)
    await update(stateId: nil, priority: priority, revert: current)
  }

  /// True once posted, so the composer can clear. `parentId` replies in that thread.
  public func comment(_ body: String, parentId: String? = nil) async -> Bool {
    let text = body.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let issue, !text.isEmpty else { return false }
    posting = true
    postingIn = parentId
    defer { (posting, postingIn) = (false, nil) }
    do {
      try await host.commentOnLinearIssue(id: issue.id, body: text, parentId: parentId)
      actionError = nil
      await load()
      return true
    } catch {
      actionError = HostStore.describe(error)
      return false
    }
  }

  private func update(stateId: String?, priority: Int?, revert: ArgusProtocol.LinearIssueDetail) async {
    updating = true
    defer { updating = false }
    do {
      if let updated = try await host.updateLinearIssue(id: revert.id, stateId: stateId, priority: priority) {
        issue?.state = updated.state
        issue?.priority = updated.priority
        issue?.updatedAt = updated.updatedAt
        onChange(updated)
      }
      actionError = nil
    } catch {
      issue = revert
      actionError = HostStore.describe(error)
    }
  }
}
