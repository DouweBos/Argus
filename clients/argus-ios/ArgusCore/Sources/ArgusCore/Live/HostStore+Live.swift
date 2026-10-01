import ArgusKit
import Foundation

/// Where `HostStore` hands a local backend's agents to `LiveAgents` and reads
/// the result back into the same slices the phone's snapshot refetch fills.
extension HostStore {
  /// Whether transcripts are built here from live events rather than fetched.
  var ownsConversations: Bool { backend?.kind == .local && live != nil }

  /// Adopt the live layer for a local backend; a gateway never gets one.
  func attachLive(_ backend: any HostBackend) {
    guard backend.kind == .local else {
      live = nil
      return
    }
    if live == nil {
      live = LiveAgents(store: self, timing: liveTiming, environment: liveEnvironment)
    }
    let live = live
    Task { await live?.resync() }
  }

  /// Route an event to the live layer. True when it was consumed there and the
  /// store's own snapshot-refetch handling must not run.
  func handleLive(_ name: RemoteEventName, _ envelope: EventEnvelope) -> Bool {
    guard ownsConversations, let live else { return false }
    switch name {
    case .agentEvent:
      guard let agentId = envelope.agentId else { return true }
      live.agentEvent(agentId, payload: envelope.payload)
      return true
    case .agentCapabilities:
      guard let agentId = envelope.agentId else { return false }
      live.capabilitiesChanged(agentId, payload: envelope.payload)
      return false
    case .ipc:
      live.ipc(envelope.payload)
      return true
    case .sessionsChanged:
      Task { await live.refreshSessions() }
      return false
    default:
      return false
    }
  }

  /// `loadTranscript` for an agent the live layer holds: its state, no fetch.
  func liveTranscript(_ key: String) -> Bool {
    guard ownsConversations, let live, live.conversations[key] != nil else { return false }
    live.project(key)
    return true
  }

  /// An image from a live conversation, straight from its bytes.
  func liveImage(_ key: String, imageId: String) -> Bool {
    guard ownsConversations, let conv = live?.conversations[key],
      let image = RemoteTranscriptBuilder.image(in: conv, id: imageId)
    else { return false }
    imageCache[imageKey(key, imageId)] = "data:\(image.mediaType);base64,\(image.data)"
    return true
  }

  func applyLiveTranscript(
    _ agentId: String, messages: [RemoteMessage], tasks: [RemoteTask]?, todos: [RemoteTodo]?,
    pendingToolName: String?
  ) {
    if messagesByAgent[agentId] != messages { messagesByAgent[agentId] = messages }
    reconcileOptimistic(for: agentId, against: messages)
    if tasksByAgent[agentId] != tasks { tasksByAgent[agentId] = tasks }
    if todosByAgent[agentId] != todos { todosByAgent[agentId] = todos }
    if pendingToolByAgent[agentId] != pendingToolName { pendingToolByAgent[agentId] = pendingToolName }
    // The whole conversation is here; there is no older page to fetch.
    if prevBeforeByAgent[agentId] != nil { prevBeforeByAgent[agentId] = nil }
  }

  /// Lay this app's view of an agent over the host's last status: the
  /// optimistic `running` after a send, and model / mode changes the typed
  /// status hasn't repeated yet.
  func overlayLiveStatus(_ agentId: String) {
    guard let agent = live?.agents[agentId] else { return }
    if var status = statusByAgent[agentId] {
      status.status = agent.status
      status.model = agent.model ?? status.model
      status.permissionMode = agent.permissionMode
      if statusByAgent[agentId] != status { statusByAgent[agentId] = status }
    }
  }
}
