import ArgusKit
import Foundation

/// The host's agent events, folded in the way `startAgentListening` folds the
/// renderer's channels. Typed gateway events cover the stream, status, queue,
/// capabilities and permissions; the rest arrive as raw `ipc` broadcasts.
extension LiveAgents {

  // MARK: Typed events

  /// `agent.event`: one stream-json event, which the host forwards as the
  /// line it read.
  func agentEvent(_ agentId: String, payload: JSONValue) {
    let event: JSONValue?
    switch payload["event"] {
    case .string(let line)?: event = JS.parse(line)
    case .object(let object)?: event = .object(object)
    default: event = nil
    }
    guard let event else { return }
    mutate(agentId) { $0.appendEvent(event) }
    scheduleSave(agentId)

    // A question or plan can land without a permission request behind it — in
    // `auto` mode the CLI approves these itself — so announce them here too.
    if event["type"]?.stringValue == "assistant" {
      for block in event["message"]?["content"]?.arrayValue ?? []
      where block["type"]?.stringValue == "tool_use" {
        if let name = block["name"]?.stringValue, let id = block["id"]?.stringValue,
          Self.awaitsAnswer(name)
        {
          notifyIfStillUnanswered(agentId, toolUseId: id, toolName: name)
        }
      }
    }

    // A `result` is not the agent going idle — background work can follow it.
    // Hold the outcome until the host's `idle` ends the turn.
    if event["type"]?.stringValue == "result" {
      finishedTurns[agentId] = FinishedTurn(
        durationMs: event["duration_ms"]?.numberValue ?? 0,
        failed: event["subtype"]?.stringValue == "error")
      settleIfHostAlreadyIdle(agentId)
    }
  }

  /// `permission.request`. The tool call can still be folding in (fast
  /// streaming, or a nested sub-agent call), so a miss retries for ~1s.
  func permissionRequested(_ request: RemotePermissionRequest) {
    notifyPermissionRequested(request)
    let agentId = request.agentId
    let toolUseId = request.toolUseId
    guard !mutate(agentId, { $0.setPermissionPending(toolUseId: toolUseId) }) else { return }
    let timing = timing
    Task { @MainActor [weak self] in
      for _ in 0..<timing.permissionRetries {
        try? await Task.sleep(for: timing.permissionRetryInterval)
        guard let self else { return }
        if self.mutate(agentId, { $0.setPermissionPending(toolUseId: toolUseId) }) { return }
      }
      // The call streamed before this app subscribed (a prompted spawn asks
      // straight away): fold it in from the request so it can be answered.
      self?.mutate(agentId) { reducer in
        reducer.appendEvent(Self.toolCallEvent(for: request))
        reducer.setPermissionPending(toolUseId: toolUseId)
      }
    }
  }

  /// The assistant event a permission request's tool call would have arrived in.
  nonisolated static func toolCallEvent(for request: RemotePermissionRequest) -> JSONValue {
    .object([
      "type": .string("assistant"),
      "message": .object([
        "id": .string("permission-\(request.toolUseId)"),
        "role": .string("assistant"),
        "content": .array([
          .object([
            "type": .string("tool_use"), "id": .string(request.toolUseId),
            "name": .string(request.toolName), "input": .object(request.toolInput),
          ])
        ]),
      ]),
    ])
  }

  /// `permission.cancel` — the host sends it both when the CLI withdraws a
  /// prompt and when anyone answers one. Published at once so a remote client
  /// sees its answer land rather than lagging a save cycle.
  func permissionCleared(_ agentId: String, toolUseId: String) {
    mutate(agentId) { $0.clearPermission(toolUseId: toolUseId) }
    saveSoon(agentId)
  }

  /// `agent.status`. The host announces only transitions on its own channel,
  /// but the typed event also repeats around prompts — so only a change counts.
  func statusChanged(_ status: RemoteAgentStatus) {
    let agentId = status.agentId
    updateAgent(agentId) {
      $0.model = status.model ?? $0.model
      $0.permissionMode = status.permissionMode ?? $0.permissionMode
    }
    let previous = hostStatus[agentId]
    hostStatus[agentId] = status.status
    guard previous != status.status else {
      store?.overlayLiveStatus(agentId)
      return
    }
    switch status.status {
    case .running, .requiresAction: setStatus(agentId, status.status)
    case .idle: onTurnOver(agentId)
    // Exits go through `agent:exit`, which saves first.
    case .stopped, .error: store?.overlayLiveStatus(agentId)
    }
  }

  /// `agent.capabilities`: the CLI is initialized and ready for input.
  func capabilitiesChanged(_ agentId: String, payload: JSONValue) {
    mutate(agentId) { $0.setCapabilities(payload) }
    if !trySendNextQueued(agentId) { trySetIdle(agentId) }
  }

  /// `agent.queue`. A message queued from another client can land after the
  /// agent already went idle, with no idle left to drain it.
  func queueChanged(_ agentId: String) {
    guard agents[agentId]?.status == .idle else { return }
    trySendNextQueued(agentId)
  }

  // MARK: Raw broadcasts

  /// Handled in arrival order; only the lookups that must reach the host wait.
  func ipc(_ payload: JSONValue) {
    guard let ipc = try? ProtocolCodec.convert(payload, to: IpcPayload.self) else { return }
    let arg = ipc.args?.first ?? .null
    switch ipc.channel {
    case "agent:started":
      guard let info = try? ProtocolCodec.convert(arg, to: AgentStartedPayload.self) else { return }
      Task { await agentStarted(info) }
      return
    case "agent_notification_clicked":
      guard let click = try? ProtocolCodec.convert(arg, to: NotificationClickedPayload.self)
      else { return }
      store?.hooks.agentNotificationClicked(click.agent_id, click.session_id)
      return
    case "session:progress":
      if let sessionId = arg.stringValue { Task { await refreshProgress(sessionId) } }
      return
    default:
      break
    }

    let parts = ipc.channel.split(separator: ":", maxSplits: 2).map(String.init)
    guard parts.count == 3, parts[0] == "agent" else { return }
    agentChannel(parts[1], agentId: parts[2], arg)
  }

  private func agentChannel(_ kind: String, agentId: String, _ arg: JSONValue) {
    switch kind {
    case "exit":
      handleExit(agentId, code: Int(arg.numberValue ?? 0))

    case "model-changed":
      guard let model = arg.stringValue else { return }
      mutate(agentId) { $0.setModel(model) }
      updateAgent(agentId) { $0.model = model }
      store?.overlayLiveStatus(agentId)

    case "runner-changed":
      updateAgent(agentId) { $0.runnerId = arg.stringValue }

    case "permission-mode-changed":
      let mode = arg.stringValue.flatMap { $0.isEmpty ? nil : $0 }
      updateAgent(agentId) { $0.permissionMode = mode }
      store?.overlayLiveStatus(agentId)

    case "effort-changed":
      updateAgent(agentId) { $0.effort = arg.stringValue }
      store?.effortByAgent[agentId] = arg.stringValue

    case "stderr":
      guard let line = arg.stringValue, !line.isEmpty else { return }
      // A structured diagnostic is a notice the run survived, not a failure.
      let diagnostic = CliDiagnostic.parse(line)
      let message = ConversationMessage(
        id: environment.makeId(), role: .system,
        textBlocks: diagnostic.map { [$0.title] + $0.details } ?? [line],
        timestamp: environment.now(), tone: diagnostic == nil ? "error" : "warning")
      mutate(agentId) { $0.appendSystemMessage(message) }

    case "mcp-message":
      guard let p = try? ProtocolCodec.convert(arg, to: McpMessagePayload.self) else { return }
      let message = ConversationMessage.injectedPrompt(
        p.message, tool: p.tool, images: p.images, parentAgentId: p.parentAgentId,
        parentLabel: p.parentLabel, timestamp: p.timestamp, environment: environment)
      mutate(agentId) { $0.appendInjectedPrompt(message) }
      scheduleSave(agentId)

    case "remote-message":
      // Another client's send: the host wrote it to stdin, so record the bubble.
      guard let p = try? ProtocolCodec.convert(arg, to: RemoteMessagePayload.self) else { return }
      // A prompted spawn's prompt is already its first bubble.
      if seededPrompts.removeValue(forKey: agentId) == p.message { return }
      mutate(agentId) { $0.addUserMessage(p.message, images: p.images, author: p.author) }
      maybeGenerateTitle(agentId, firstMessage: p.message)
      scheduleSave(agentId)

    default:
      break
    }
  }

  func handleExit(_ agentId: String, code: Int) {
    // Save while the conversation is still whole.
    saveSoon(agentId)
    let status: RemoteAgentState = code == 0 ? .stopped : .error
    hostStatus[agentId] = status
    setStatus(agentId, status)
    inflight.remove(agentId)
  }

  /// Make sure the session's repo is listed, so its progress can be read. Once
  /// listed, the store's own `sessions.changed` handling keeps it fresh.
  private func refreshProgress(_ sessionId: String) async {
    if sessions[sessionId] == nil { await refreshSessions() }
    guard let store, let repoRoot = sessions[sessionId]?.repoRoot,
      store.sessionsByRepo[repoRoot] == nil
    else { return }
    await store.loadSessions(repoRoot: repoRoot)
  }

  /// A turn whose `running` the host announced before we subscribed never
  /// gets an idle *transition* — the host already says idle. Settle it from
  /// the result once the host has had a moment to report otherwise.
  private func settleIfHostAlreadyIdle(_ agentId: String) {
    Task { @MainActor [weak self] in
      try? await Task.sleep(for: .seconds(1))
      guard let self, self.finishedTurns[agentId] != nil,
        self.hostStatus[agentId] == .idle, self.agents[agentId]?.status == .running
      else { return }
      self.onTurnOver(agentId)
    }
  }
}
