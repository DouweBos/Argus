import ArgusCore
import Foundation
import GroveKit
import Observation

/// Every session's `GitWorkspace`, opened on first use from the session's
/// worktree path, and refreshed by the host's git and session broadcasts.
@MainActor
@Observable
final class GitWorkspaces {
  enum Slot {
    case opening
    case open(GitWorkspace)
    case failed(String)
  }

  private(set) var slots: [String: Slot] = [:]
  /// Grove's names, so restacks and branch parents are shared with Grove on the same repository.
  private static let naming = GitNaming(name: "grove")
  private let host: HostStore
  private var stopObserving: (() -> Void)?

  init(host: HostStore) {
    self.host = host
    stopObserving = host.observeIpc { [weak self] channel, args, _ in
      self?.broadcast(channel: channel, args: args)
    }
  }

  func workspace(_ sessionId: String) -> GitWorkspace? {
    if case .open(let workspace) = slots[sessionId] { return workspace }
    return nil
  }

  /// Opens the session's repository once; later calls return the same one.
  @discardableResult
  func open(_ session: RemoteSession) async -> GitWorkspace? {
    switch slots[session.id] {
    case .open(let workspace): return workspace
    case .opening: return nil
    case .failed, nil: break
    }
    slots[session.id] = .opening
    if let router = host.backend as? HostRouter, case let hostId = router.host(of: .session, session.id),
      hostId != Hosts.local
    {
      return await openRemote(session, on: hostId, router: router)
    }
    guard let backend = host.backend,
      let path = (try? await backend.request(ArgusProtocol.Commands.GetSession.self, .init(id: session.id)))??.path,
      !path.isEmpty
    else {
      slots[session.id] = .failed("The session's worktree isn't available.")
      return nil
    }
    do {
      let repository = try await GitRepository(
        path: URL(fileURLWithPath: path), runner: LocalGitRunner(), naming: Self.naming)
      let workspace = GitWorkspace(session: session, repository: repository, host: host)
      Task { await GitPreferences.apply(to: workspace.workingCopy) }
      slots[session.id] = .open(workspace)
      return workspace
    } catch {
      slots[session.id] = .failed(error.localizedDescription)
      return nil
    }
  }

  /// A session on a paired host: GroveKit runs git there, over the gateway.
  private func openRemote(_ session: RemoteSession, on hostId: HostId, router: HostRouter) async -> GitWorkspace? {
    let store = host
    do {
      let (runner, worktree) = try await GatewayGitRunner.open(
        hostId: hostId, sessionId: session.id, backend: router
      ) { channel, handler in
        await MainActor.run {
          nonisolated(unsafe) let stop = store.observeIpc { name, args, _ in
            if name == channel, let payload = args.first { handler(payload) }
          }
          // `observeIpc`'s canceller hops to the main actor itself.
          return { stop() }
        }
      }
      let repository = try await GitRepository(path: worktree, runner: runner, naming: Self.naming)
      let workspace = GitWorkspace(session: session, repository: repository, host: host, isRemote: true)
      Task { await GitPreferences.apply(to: workspace.workingCopy) }
      slots[session.id] = .open(workspace)
      return workspace
    } catch {
      slots[session.id] = .failed(HostStore.describe(error))
      return nil
    }
  }

  /// Forget a failed open so the next look tries again.
  func retry(_ sessionId: String) {
    if case .failed = slots[sessionId] { slots[sessionId] = nil }
  }

  /// Only the workspace on screen watches files; the rest keep their lists.
  func show(_ sessionId: String?) {
    for (id, slot) in slots {
      guard case .open(let workspace) = slot, id != sessionId else { continue }
      workspace.pause()
    }
  }

  // MARK: Host broadcasts

  private func broadcast(channel: String, args: [JSONValue]) {
    if let id = channel.suffix(after: "session:diff-changed:") ?? channel.suffix(after: "session:branch-changed:") {
      refresh(id)
      return
    }
    switch channel {
    case "git_status_changed":
      if case .object(let payload) = args.first, case .string(let id) = payload["sessionId"] { refresh(id) }
    case "session:commit-landed", "session:merged", "session:updated":
      // A landing moves the base branch every session of the repo compares to.
      for (id, slot) in slots { if case .open(let w) = slot, w.isActive { refresh(id) } }
    case "session:deleted":
      if case .string(let id) = args.first { forget(id) }
      if case .object(let payload) = args.first, case .string(let id) = payload["id"] { forget(id) }
    default:
      break
    }
  }

  private func refresh(_ sessionId: String) {
    guard let workspace = workspace(sessionId), workspace.isActive else { return }
    Task { await workspace.refreshAll() }
  }

  private func forget(_ sessionId: String) {
    workspace(sessionId)?.pause()
    slots[sessionId] = nil
  }
}

extension String {
  fileprivate func suffix(after prefix: String) -> String? {
    hasPrefix(prefix) ? String(dropFirst(prefix.count)) : nil
  }
}
