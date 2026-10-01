import ArgusKit
import Foundation

/// Branches on a project root: history, commits, and everything the desktop's
/// branch menu does. Reads are monitor-tier; everything that moves a ref needs
/// `control`, enforced by the gateway.
extension HostStore {

  public enum CheckoutOutcome: Sendable { case ok, dirty, failed }

  public func checkoutBranch(
    sessionId: String, repoRoot: String, branch: String, dirty: String? = nil
  ) async -> CheckoutOutcome {
    guard let backend else { return .failed }
    struct Params: Encodable {
      let session_id: String
      let branch: String
      let dirty: String?
    }
    struct Result: Decodable {
      let accepted: Bool
      let blocked_by: String?
    }
    do {
      let result = try await backend.request(
        .sessionsCheckout, Params(session_id: sessionId, branch: branch, dirty: dirty),
        as: Result.self)
      if result.blocked_by == "dirty" { return .dirty }
      if result.accepted { hooks.track(.branchActed(action: .checkout)) }
      await loadGitStatus(sessionId: sessionId)
      await loadSessions(repoRoot: repoRoot)
      return result.accepted ? .ok : .failed
    } catch {
      report(error)
      return .failed
    }
  }

  public func createBranch(
    sessionId: String, repoRoot: String, name: String, checkout: Bool, startPoint: String? = nil
  ) async {
    guard let backend else { return }
    struct Params: Encodable {
      let session_id: String
      let name: String
      let checkout: Bool
      let start_point: String?
    }
    do {
      try await backend.request(
        .sessionsCreateBranch,
        Params(session_id: sessionId, name: name, checkout: checkout, start_point: startPoint),
        as: IgnoredResult.self)
      hooks.track(.branchActed(action: .create))
      await loadGitStatus(sessionId: sessionId)
    } catch { report(error) }
  }

  public enum DeleteBranchOutcome: Sendable { case ok, unmerged, failed }

  public func deleteBranch(sessionId: String, name: String, force: Bool = false) async
    -> DeleteBranchOutcome
  {
    guard let backend else { return .failed }
    struct Params: Encodable {
      let session_id: String
      let name: String
      let force: Bool
    }
    struct Result: Decodable {
      let accepted: Bool
      let blocked_by: String?
    }
    do {
      let result = try await backend.request(
        .sessionsDeleteBranch, Params(session_id: sessionId, name: name, force: force),
        as: Result.self)
      if result.blocked_by == "unmerged" { return .unmerged }
      if result.accepted { hooks.track(.branchActed(action: .delete)) }
      return result.accepted ? .ok : .failed
    } catch {
      report(error)
      return .failed
    }
  }

  // MARK: History

  /// `ref` is the branch as git knows it: `origin/x` for a remote-only one.
  public func branchLog(sessionId: String, ref: String, count: Int = 100) async -> [RemoteCommit]? {
    guard let backend else { return nil }
    struct Params: Encodable {
      let session_id: String
      let branch: String
      let count: Int
    }
    struct Result: Decodable { let commits: [RemoteCommit] }
    do {
      return try await backend.request(
        .sessionsBranchLog, Params(session_id: sessionId, branch: ref, count: count),
        as: Result.self
      ).commits
    } catch {
      report(error, scope: "branch:log")
      return nil
    }
  }

  public func commitDiff(sessionId: String, hash: String) async -> String? {
    guard let backend else { return nil }
    struct Params: Encodable {
      let session_id: String
      let hash: String
    }
    struct Result: Decodable { let diff: String }
    do {
      return try await backend.request(
        .sessionsCommitDiff, Params(session_id: sessionId, hash: hash), as: Result.self
      ).diff
    } catch {
      report(error, scope: "branch:commit")
      return nil
    }
  }

  public func compareBranches(sessionId: String, left: String, right: String) async
    -> RemoteBranchCompare?
  {
    guard let backend else { return nil }
    struct Params: Encodable {
      let session_id: String
      let left: String
      let right: String
    }
    do {
      return try await backend.request(
        .sessionsCompareBranches, Params(session_id: sessionId, left: left, right: right),
        as: RemoteBranchCompare.self)
    } catch {
      report(error, scope: "branch:compare")
      return nil
    }
  }

  /// GitHub's "open a PR" page; nil when the repo has no GitHub remote.
  public func branchPullRequestURL(sessionId: String, branch: String) async -> URL? {
    guard let backend else { return nil }
    struct Params: Encodable {
      let session_id: String
      let branch: String
    }
    struct Result: Decodable { let url: String? }
    let result = try? await backend.request(
      .sessionsBranchPrUrl, Params(session_id: sessionId, branch: branch), as: Result.self)

    return result?.url.flatMap(URL.init(string:))
  }

  // MARK: Branch actions

  /// Run one branch action, refresh what it changed, and report a failure —
  /// a merge that stopped on conflicts included — through the app banner.
  private func branchAction<P: Encodable & Sendable>(
    _ method: RemoteMethod, _ params: P, sessionId: String, action: StoreEvent.BranchAction
  ) async -> Bool {
    guard let backend else { return false }
    do {
      try await backend.request(method, params, as: IgnoredResult.self)
      hooks.track(.branchActed(action: action))
      await loadGitStatus(sessionId: sessionId)
      return true
    } catch {
      report(error, scope: "branch:\(action.rawValue)")
      return false
    }
  }

  public func mergeIntoCurrent(sessionId: String, from: String, squash: Bool) async -> Bool {
    struct Params: Encodable {
      let session_id: String
      let from: String
      let squash: Bool
    }
    return await branchAction(
      .sessionsMergeBranch, Params(session_id: sessionId, from: from, squash: squash),
      sessionId: sessionId, action: .merge)
  }

  public func rebaseCurrent(sessionId: String, onto: String) async -> Bool {
    struct Params: Encodable {
      let session_id: String
      let onto: String
    }
    return await branchAction(
      .sessionsRebaseCurrent, Params(session_id: sessionId, onto: onto),
      sessionId: sessionId, action: .rebase)
  }

  public func pushBranch(
    sessionId: String, branch: String, remote: String?, setUpstream: Bool, forceWithLease: Bool
  ) async -> Bool {
    struct Params: Encodable {
      let session_id: String
      let branch: String
      let remote: String?
      let set_upstream: Bool
      let force_with_lease: Bool
    }
    return await branchAction(
      .sessionsPushBranch,
      Params(
        session_id: sessionId, branch: branch, remote: remote, set_upstream: setUpstream,
        force_with_lease: forceWithLease),
      sessionId: sessionId, action: .push)
  }

  public enum PullStrategy: String, CaseIterable, Sendable {
    case ffOnly = "ff-only"
    case merge, rebase

    public var label: String {
      switch self {
      case .ffOnly: "Fast-forward"
      case .merge: "Merge"
      case .rebase: "Rebase"
      }
    }
  }

  public func pullCurrent(sessionId: String, strategy: PullStrategy) async -> Bool {
    struct Params: Encodable {
      let session_id: String
      let strategy: String
    }
    return await branchAction(
      .sessionsPull, Params(session_id: sessionId, strategy: strategy.rawValue),
      sessionId: sessionId, action: .pull)
  }

  public func renameLocalBranch(sessionId: String, from: String, to: String) async -> Bool {
    struct Params: Encodable {
      let session_id: String
      let from: String
      let to: String
    }
    return await branchAction(
      .sessionsRenameLocalBranch, Params(session_id: sessionId, from: from, to: to),
      sessionId: sessionId, action: .rename)
  }

  public func setBranchPinned(sessionId: String, branch: String, pinned: Bool) async -> Bool {
    struct Params: Encodable {
      let session_id: String
      let branch: String
      let pinned: Bool
    }
    return await branchAction(
      .sessionsPinBranch, Params(session_id: sessionId, branch: branch, pinned: pinned),
      sessionId: sessionId, action: .pin)
  }
}
