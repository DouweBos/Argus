import ArgusKit
import Foundation

/// Where a held transcript sits among the host's `agent.transcript` deltas.
struct TranscriptSync: Equatable {
  var epoch: String
  var revision: Int
}

/// `agent.transcript`: messages upserted by id (unknown ids append in order),
/// ids removed or now hidden, and the current meta — nil clears.
struct TranscriptDelta: Decodable, Sendable {
  let agentId: String
  let epoch: String
  let revision: Int
  let total: Int
  let messages: [RemoteMessage]
  let removedIds: [String]
  let title: String?
  let model: String?
  let pendingToolName: String?
  let tasks: [RemoteTask]?
  let todos: [RemoteTodo]?
  /// Nil from an older host.
  let followUps: [String]?

  enum CodingKeys: String, CodingKey {
    case epoch, revision, total, messages, title, model, tasks, todos
    case agentId = "agent_id"
    case removedIds = "removed_ids"
    case pendingToolName = "pending_tool_name"
    case followUps = "follow_ups"
  }
}

/// Following the host's transcript: the tail page says where it stands, each
/// delta moves it one revision on. Anything that doesn't line up — a gap, a
/// restarted host, a page never fetched — falls back to refetching the tail.
/// A host that never sends a delta keeps the refetch-per-event path.
extension HostStore {

  /// Whether this agent's transcript follows deltas, so polling it is waste.
  public func followsTranscriptDeltas(_ key: String) -> Bool {
    transcriptSync[key] != nil && deltaAgents.contains(key)
  }

  /// A refetch of the tail (the poll behind a view, the check after a send)
  /// that only a host sending no deltas needs.
  public func refreshTranscript(agentId key: String) async {
    // A saved chat never changes.
    guard !followsTranscriptDeltas(key), Self.parseStoppedKey(key) == nil else { return }
    await loadTranscript(agentId: key)
  }

  /// Events only say the transcript moved; once deltas carry the change itself
  /// they need no refetch.
  /// A local backend hears every agent; only the ones on screen are refetched.
  func refreshUnlessFollowing(_ agentId: String) {
    guard !deltaAgents.contains(agentId), !followsAllAgents || watchedAgents.contains(agentId)
    else { return }
    scheduleTranscriptRefresh(agentId)
  }

  func receive(_ delta: TranscriptDelta) {
    let key = delta.agentId
    deltaAgents.insert(key)
    if tailFetches[key, default: 0] > 0 {
      bufferedDeltas[key, default: []].append(delta)
      return
    }
    applyOrRefetch(delta)
  }

  private func applyOrRefetch(_ delta: TranscriptDelta) {
    let key = delta.agentId
    if let known = transcriptSync[key], known.epoch == delta.epoch {
      if delta.revision <= known.revision { return }
      if delta.revision == known.revision + 1 {
        apply(delta)
        return
      }
    }
    // Out of line: the next tail page re-establishes where it stands. An agent
    // no view is showing just waits until one opens it.
    transcriptSync[key] = nil
    if watchedAgents.contains(key) { scheduleTranscriptRefresh(key) }
  }

  private func apply(_ delta: TranscriptDelta) {
    let key = delta.agentId
    transcriptSync[key]?.revision = delta.revision
    // A rewind can cut below the loaded window; its older-page cursor would
    // point past the end.
    if let cursor = prevBeforeByAgent[key], Double(delta.total) < cursor {
      transcriptSync[key] = nil
      prevBeforeByAgent[key] = nil
      messagesByAgent[key] = nil
      scheduleTranscriptRefresh(key)
      return
    }

    let existing = messagesByAgent[key] ?? []
    let next = Self.applying(delta, to: existing, olderUnloaded: prevBeforeByAgent[key] != nil)
    if next != existing { messagesByAgent[key] = next }
    reconcileOptimistic(for: key, against: next)

    if tasksByAgent[key] != delta.tasks { tasksByAgent[key] = delta.tasks }
    if todosByAgent[key] != delta.todos { todosByAgent[key] = delta.todos }
    setFollowUps(delta.followUps, for: key)
    if pendingToolByAgent[key] != delta.pendingToolName { pendingToolByAgent[key] = delta.pendingToolName }
    if let title = delta.title { patchStatus(key) { $0.title = title } }
    if let model = delta.model { patchStatus(key) { $0.model = model } }
  }

  /// An empty or missing list clears the agent's suggestions.
  func setFollowUps(_ followUps: [String]?, for key: String) {
    let next = followUps ?? []
    guard followUpsByAgent[key] ?? [] != next else { return }
    followUpsByAgent[key] = next.isEmpty ? nil : next
  }

  /// Upsert by id, keeping the held element wherever it is unchanged so views
  /// keep their identity. An unknown message older than the loaded window
  /// belongs to a page not fetched yet, not at the end.
  nonisolated static func applying(
    _ delta: TranscriptDelta, to existing: [RemoteMessage], olderUnloaded: Bool
  ) -> [RemoteMessage] {
    var messages = existing
    if !delta.removedIds.isEmpty {
      let removed = Set(delta.removedIds)
      messages.removeAll { removed.contains($0.id) }
    }
    var index = Dictionary(
      messages.enumerated().map { ($1.id, $0) }, uniquingKeysWith: { first, _ in first })
    let floor = olderUnloaded ? messages.first?.timestamp : nil
    for message in delta.messages {
      if let at = index[message.id] {
        if messages[at] != message { messages[at] = message }
      } else if let floor, let stamp = message.timestamp, stamp < floor {
        continue
      } else {
        index[message.id] = messages.count
        messages.append(message)
      }
    }
    return messages
  }

  func patchStatus(_ agentId: String, _ body: (inout RemoteAgentStatus) -> Void) {
    if var status = statusByAgent[agentId] {
      body(&status)
      if statusByAgent[agentId] != status { statusByAgent[agentId] = status }
    }
    for (repo, agents) in agentsByRepo {
      if let at = agents.firstIndex(where: { $0.agentId == agentId }) {
        var status = agents[at]
        body(&status)
        if agents[at] != status { agentsByRepo[repo]?[at] = status }
      }
    }
    if let at = recentAgents.firstIndex(where: { $0.agentId == agentId }) {
      var status = recentAgents[at]
      body(&status)
      if recentAgents[at] != status { recentAgents[at] = status }
    }
  }

  // MARK: Tail fetches

  func tailFetchStarted(_ key: String) {
    tailFetches[key, default: 0] += 1
  }

  /// Whether a tail page is older than what the deltas already brought — a
  /// slow fetch landing after a newer one.
  func isStale(_ page: RemoteTranscript, for key: String) -> Bool {
    guard let epoch = page.epoch, let revision = page.revision,
      let known = transcriptSync[key], known.epoch == epoch
    else { return false }
    return revision < known.revision
  }

  /// A page from a new epoch is a re-seeded conversation: what was held, and
  /// its older-page cursor, belong to the old one.
  func replaceIfNewEpoch(_ page: RemoteTranscript, for key: String) {
    guard let epoch = page.epoch else { return }
    if let held = heldEpochs[key], held != epoch {
      messagesByAgent[key] = nil
      prevBeforeByAgent[key] = nil
    }
    heldEpochs[key] = epoch
  }

  /// A tail page was merged (or skipped as stale): take its position, then
  /// replay what arrived while it was in flight.
  func tailFetchLanded(_ key: String, page: RemoteTranscript) {
    if let epoch = page.epoch, let revision = page.revision {
      if !isStale(page, for: key) { transcriptSync[key] = TranscriptSync(epoch: epoch, revision: revision) }
    } else {
      // An older host, or a fetch that failed: nothing to line deltas up against.
      transcriptSync[key] = nil
    }
    let remaining = max(0, tailFetches[key, default: 0] - 1)
    tailFetches[key] = remaining == 0 ? nil : remaining
    guard remaining == 0, let buffered = bufferedDeltas.removeValue(forKey: key) else { return }
    for delta in buffered { applyOrRefetch(delta) }
  }

  /// A new connection: subscriptions and anything sent while away are gone,
  /// so every shown transcript is fetched again and events refetch until the
  /// first delta arrives.
  func resyncTranscripts() {
    forgetTranscriptSync()
    for key in watchedAgents { scheduleTranscriptRefresh(key) }
  }

  func forgetTranscriptSync() {
    transcriptSync = [:]
    tailFetches = [:]
    bufferedDeltas = [:]
    deltaAgents = []
  }
}
