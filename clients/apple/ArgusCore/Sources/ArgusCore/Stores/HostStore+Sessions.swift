import ArgusKit
import Foundation

/// Control-scoped session actions: create, rename, delete, land work.
extension HostStore {

  // MARK: Sessions

  @discardableResult
  public func createSession(
    repoRoot: String, branch: String, description: String,
    useExistingBranch: Bool? = nil, baseBranch: String? = nil, prompt: String? = nil
  ) async -> RemoteSession? {
    guard let backend else { return nil }
    struct Params: Encodable {
      let repo_root: String
      let branch: String
      let description: String
      let use_existing_branch: Bool?
      let base_branch: String?
      let prompt: String?
    }
    struct Result: Decodable { let session: RemoteSession }
    do {
      return try await backend.request(
        .sessionsCreate,
        Params(
          repo_root: repoRoot, branch: branch, description: description,
          use_existing_branch: useExistingBranch, base_branch: baseBranch, prompt: prompt),
        as: Result.self
      ).session
    } catch {
      report(error)
      return nil
    }
  }

  /// Hand a plan to a fresh session. The computer starts the agent once the
  /// worktree is ready, so backgrounding the phone can't strand the plan.
  public func handOffPlan(repoRoot: String, plan: String) async {
    let prompt = "Implement the following plan:\n\n\(plan)"
    guard
      await createSession(repoRoot: repoRoot, branch: "", description: prompt, prompt: prompt)
        != nil
    else { return }
    await loadSessions(repoRoot: repoRoot)
  }

  // MARK: Landing work

  /// Stage everything and commit. Returns git's own output, or nil when it
  /// refused — the message is already on `lastError` by then.
  public func commit(sessionId: String, message: String) async -> String? {
    guard let backend else { return nil }
    struct Params: Encodable {
      let session_id: String
      let message: String
    }
    struct Result: Decodable { let output: String }
    do {
      let output = try await backend.request(
        .sessionsCommit, Params(session_id: sessionId, message: message),
        as: Result.self
      ).output
      hooks.track(.workLanded(action: .commit, success: true))
      await loadGitStatus(sessionId: sessionId)

      return output
    } catch {
      report(error, scope: "session:commit")
      hooks.track(.workLanded(action: .commit, success: false))

      return nil
    }
  }

  public struct PushResult: Decodable, Sendable {
    public let branch: String
    public let remote: String
    /// GitHub's "create a PR" link, when the push printed one.
    public let pr_url: String?
  }

  @discardableResult
  public func push(sessionId: String) async -> PushResult? {
    guard let backend else { return nil }
    struct Params: Encodable { let session_id: String }
    do {
      let result = try await backend.request(
        .sessionsPush, Params(session_id: sessionId), as: PushResult.self)
      hooks.track(.workLanded(action: .push, success: true))
      await loadGitStatus(sessionId: sessionId)

      return result
    } catch {
      report(error, scope: "session:push")
      hooks.track(.workLanded(action: .push, success: false))

      return nil
    }
  }

  /// Empty means the merge would go through.
  public func mergeBlockers(sessionId: String) async -> [String] {
    guard let backend else { return [] }
    struct Params: Encodable { let session_id: String }
    struct Result: Decodable { let blockers: [String] }
    guard let result = try? await backend.request(
      .sessionsMergeBlockers, Params(session_id: sessionId), as: Result.self) else { return [] }

    return result.blockers
  }

  /// What a merge does to the session's commits. Squashing rewrites history
  /// the agent wrote, so the phone asks rather than assuming.
  public enum MergeStrategy: String, Sendable {
    case keep
    case squash

    public var label: String {
      switch self {
      case .keep: "Keep every commit"
      case .squash: "Squash into one commit"
      }
    }
  }

  @discardableResult
  public func mergeIntoBase(sessionId: String, strategy: MergeStrategy) async -> Bool {
    guard let backend else { return false }
    struct Params: Encodable {
      let session_id: String
      let strategy: String
    }
    do {
      try await backend.request(
        .sessionsMergeBase, Params(session_id: sessionId, strategy: strategy.rawValue),
        as: IgnoredResult.self)
      hooks.track(
        .workLanded(action: .merge, success: true, strategy: strategy.rawValue))
      await loadGitStatus(sessionId: sessionId)

      return true
    } catch {
      report(error, scope: "session:merge")
      hooks.track(
        .workLanded(action: .merge, success: false, strategy: strategy.rawValue))

      return false
    }
  }

  // MARK: Scratch pads

  /// Create a scratch pad and start its agent, so there is a chat to land in.
  public func createScratchPad() async -> RemoteAgentStatus? {
    guard let backend else { return nil }
    struct Params: Encodable { let name: String? }
    struct Result: Decodable { let session: RemoteSession }
    do {
      let pad = try await backend.request(
        .scratchPadsCreate, Params(name: nil), as: Result.self
      ).session
      await loadScratchPads()
      return await spawnAgent(sessionId: pad.id)
    } catch {
      report(error)
      return nil
    }
  }

  /// The pad's agent to open: its newest live one, else a fresh one when this
  /// phone may start agents.
  public func scratchPadAgent(_ pad: RemoteSession) async -> RemoteAgentStatus? {
    guard let backend else { return nil }
    struct Params: Encodable { let session_id: String }
    struct Result: Decodable { let agents: [RemoteAgentStatus] }
    let agents = (try? await backend.request(
      .agentsList, Params(session_id: pad.id), as: Result.self))?.agents ?? []
    for agent in agents { statusByAgent[agent.agentId] = agent }
    if let live = agents
      .filter({ $0.status != .stopped })
      .max(by: { ($0.createdAt ?? 0) < ($1.createdAt ?? 0) })
    {
      return live
    }
    return hasControl ? await spawnAgent(sessionId: pad.id) : nil
  }

  /// Deleting a pad removes its folder too — there is no branch to keep.
  public func deleteScratchPad(id: String) async {
    guard let backend else { return }
    struct Params: Encodable { let id: String }
    do {
      try await backend.request(.sessionsDelete, Params(id: id), as: IgnoredResult.self)
      await loadScratchPads()
    } catch { report(error) }
  }

  public func deleteSession(id: String, repoRoot: String, deleteBranch: Bool = false) async {
    guard let backend else { return }
    struct Params: Encodable {
      let id: String
      let delete_branch: Bool
    }
    do {
      try await backend.request(
        .sessionsDelete, Params(id: id, delete_branch: deleteBranch),
        as: IgnoredResult.self)
      await loadSessions(repoRoot: repoRoot)
      await loadAgents(repoRoot: repoRoot)
    } catch { report(error) }
  }

  public func renameSession(id: String, repoRoot: String, name: String) async {
    guard let backend else { return }
    struct Params: Encodable {
      let id: String
      let display_name: String
    }
    do {
      try await backend.request(
        .sessionsRename, Params(id: id, display_name: name), as: IgnoredResult.self)
      hooks.track(.sessionRenamed(target: "session"))
      await loadSessions(repoRoot: repoRoot)
    } catch { report(error) }
  }

  /// Point a session at a different base branch. The computer refuses a
  /// remote-tracking ref like `origin/main` — only a local branch can be
  /// fast-forwarded onto.
  public func setBaseBranch(id: String, baseBranch: String) async {
    guard let backend else { return }
    struct Params: Encodable {
      let id: String
      let base_branch: String
    }
    do {
      try await backend.request(
        .sessionsSetBaseBranch, Params(id: id, base_branch: baseBranch),
        as: IgnoredResult.self)
      hooks.track(.sessionRenamed(target: "base"))
      if let repoRoot = repoRoot(forSessionId: id) {
        await loadSessions(repoRoot: repoRoot)
      }
    } catch { report(error, scope: "session:base_branch") }
  }

  public func renameSessionBranch(id: String, repoRoot: String, branch: String) async {
    guard let backend else { return }
    struct Params: Encodable {
      let id: String
      let branch: String
    }
    do {
      try await backend.request(
        .sessionsRenameBranch, Params(id: id, branch: branch), as: IgnoredResult.self)
      hooks.track(.sessionRenamed(target: "branch"))
      await loadSessions(repoRoot: repoRoot)
    } catch { report(error) }
  }

  /// Re-run setup for a session whose setup failed. The computer records
  /// the outcome itself, so the phone sends no telemetry.
  public func retrySessionSetup(id: String, repoRoot: String) async {
    guard let backend else { return }
    struct Params: Encodable { let id: String }
    do {
      try await backend.request(.sessionsRetrySetup, Params(id: id), as: IgnoredResult.self)
      await loadSessions(repoRoot: repoRoot)
    } catch { report(error, scope: "session:retry_setup") }
  }

  /// Unblock a session after its failed setup step was fixed by hand.
  public func markSessionReady(id: String, repoRoot: String) async {
    guard let backend else { return }
    struct Params: Encodable { let id: String }
    do {
      try await backend.request(.sessionsMarkReady, Params(id: id), as: IgnoredResult.self)
      await loadSessions(repoRoot: repoRoot)
    } catch { report(error, scope: "session:mark_ready") }
  }

  // MARK: Mentions

  public func listFiles(sessionId: String) async -> [String] {
    guard let backend else { return [] }
    struct Params: Encodable { let session_id: String }
    struct Result: Decodable { let files: [String] }
    let result = try? await backend.request(
      .sessionsFiles, Params(session_id: sessionId), as: Result.self)
    return result?.files ?? []
  }

  public func resolveMentionPath(sessionId: String, query: String) async -> RemoteMentionPathResult? {
    guard let backend else { return nil }
    struct Params: Encodable {
      let session_id: String
      let query: String
    }
    return try? await backend.request(
      .sessionsResolveMentionPath, Params(session_id: sessionId, query: query),
      as: RemoteMentionPathResult.self)
  }
}
