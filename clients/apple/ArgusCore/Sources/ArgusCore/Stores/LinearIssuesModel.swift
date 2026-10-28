import ArgusKit
import Foundation
import Observation

/// The Issues screen's list of Linear issues for one scope. Shared by the
/// Mac's board and the phone's list, so a change made in an issue's detail
/// shows on both without asking Linear again.
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
  /// Nil until the first answer for this scope.
  public private(set) var issues: [ArgusProtocol.LinearIssue]?
  public private(set) var error: String?
  public private(set) var refreshing = false

  private unowned let host: HostStore

  public init(host: HostStore) {
    self.host = host
  }

  public func refresh() async {
    guard host.linearConnected else {
      issues = nil
      error = nil
      return
    }
    let asked = scope
    refreshing = true
    defer { refreshing = false }
    do {
      let found = try await host.linearIssues(query: "", scope: asked, limit: 100)
      guard asked == scope else { return }
      issues = found
      error = nil
    } catch {
      guard asked == scope else { return }
      self.error = HostStore.describe(error)
    }
    // "Agent on it" needs every project's sessions, not just the ones opened.
    for project in host.projects {
      await host.loadSessions(repoRoot: project.repoRoot)
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

  /// True once posted, so the composer can clear.
  public func comment(_ body: String) async -> Bool {
    let text = body.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let issue, !text.isEmpty else { return false }
    posting = true
    defer { posting = false }
    do {
      try await host.commentOnLinearIssue(id: issue.id, body: text)
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
