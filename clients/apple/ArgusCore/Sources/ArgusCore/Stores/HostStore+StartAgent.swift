import ArgusKit
import Foundation

/// Starting an agent with its first message, in a session or a new worktree,
/// as the Mac's start composer and the phone's start sheet both do.
extension HostStore {
  /// Spawns an agent in a session and returns its id, or nil when it didn't
  /// start (the store reports why). `mode` is raw: one no gateway mode carries
  /// (`trusted`) goes through the admin start, which only a local backend has.
  public func startAgent(
    sessionId: String, mode: String?, model: String?, runnerId: String? = nil
  ) async -> String? {
    let remoteMode = mode.flatMap(RemotePermissionMode.init(rawValue:))
    if let mode, remoteMode == nil, backend?.kind == .local {
      return await startTrusted(sessionId: sessionId, mode: mode, model: model)
    }
    return await spawnAgent(sessionId: sessionId, model: model, permissionMode: remoteMode, runnerId: runnerId)?
      .agentId
  }

  /// An agent in the session with the request as its first turn. `onSpawned`
  /// runs once it exists, before the message lands — where a caller navigates.
  @discardableResult
  public func startAgent(
    inSession id: String, with request: ComposerStart, defaults: AgentStartDefaults,
    onSpawned: (@MainActor (_ agentId: String, _ sessionId: String) -> Void)? = nil
  ) async -> String? {
    guard
      let agentId = await startAgent(
        sessionId: id, mode: request.permissionMode?.rawValue ?? defaults.mode,
        model: request.model ?? defaults.model, runnerId: request.runnerId)
    else { return nil }
    if let effort = request.effort ?? defaults.effort { await setEffort(agentId: agentId, level: effort) }
    let hasMessage = !request.message.isEmpty || !request.images.isEmpty
    let send = hasMessage
      ? Task {
        await sendMessage(
          agentId: agentId, message: request.message, images: request.images, displayText: request.displayText)
      } : nil
    onSpawned?(agentId, id)
    await send?.value
    return agentId
  }

  /// A new worktree off `baseBranch`, or on `existingBranch`, with the request's agent.
  /// Text alone rides the session's own prompt, which the host starts once
  /// setup finishes; images and effort can't, so this starts that agent itself.
  @discardableResult
  public func startInNewWorktree(
    repoRoot: String, baseBranch: String?, existingBranch: String? = nil,
    request: ComposerStart, defaults: AgentStartDefaults,
    onSpawned: (@MainActor (_ agentId: String, _ sessionId: String) -> Void)? = nil
  ) async -> RemoteSession? {
    let effort = request.effort ?? defaults.effort
    let hostStarts = request.images.isEmpty && effort == nil
    // The host's own start can't take `trusted`; nil leaves it to the host's default.
    let mode = request.permissionMode ?? defaults.mode.flatMap(RemotePermissionMode.init(rawValue:))
    guard
      let session = await createSession(
        repoRoot: repoRoot, branch: existingBranch ?? "", description: request.displayText,
        useExistingBranch: existingBranch != nil ? true : nil,
        baseBranch: existingBranch == nil ? baseBranch : nil,
        prompt: hostStarts && !request.message.isEmpty ? request.message : nil,
        model: request.model ?? defaults.model, permissionMode: mode, runnerId: request.runnerId)
    else { return nil }
    if !hostStarts {
      Task { await startWhenReady(session.id, request: request, defaults: defaults, onSpawned: onSpawned) }
    }
    return session
  }

  /// Waits out a new worktree's setup, then starts its agent.
  @discardableResult
  public func startWhenReady(
    _ id: String, request: ComposerStart, defaults: AgentStartDefaults,
    onSpawned: (@MainActor (_ agentId: String, _ sessionId: String) -> Void)? = nil
  ) async -> String? {
    let deadline = Date.now.addingTimeInterval(30 * 60)
    while Date.now < deadline {
      switch session(id: id)?.status {
      case .ready:
        return await startAgent(inSession: id, with: request, defaults: defaults, onSpawned: onSpawned)
      case .error, .deleting:
        return nil
      default:
        try? await Task.sleep(for: .seconds(1))
      }
    }
    return nil
  }

  /// Any session this store holds: a project's, a scratch pad, or one adopted by id.
  public func session(id: String) -> RemoteSession? {
    sessionsByRepo.values.joined().first { $0.id == id }
      ?? scratchPads.first { $0.id == id } ?? adoptedSessions[id]
  }

  /// `trusted` is a CLI flag fixed at launch, and the gateway's spawn refuses
  /// it; the admin command takes any mode and announces the agent the same way.
  private func startTrusted(sessionId: String, mode: String, model: String?) async -> String? {
    guard let backend else { return nil }
    do {
      let info = try await backend.request(
        ArgusProtocol.Commands.StartAgent.self, .init(sessionId: sessionId, model: model, permissionMode: mode))
      if let repoRoot = repoRoot(forSessionId: sessionId) { await loadAgents(repoRoot: repoRoot) }
      return info.agentId
    } catch {
      report(error)
      return nil
    }
  }
}
