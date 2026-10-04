import ArgusKit
import Foundation
import Observation

/// The conversation owner for a host this app supervises: subscribes to every
/// live agent, folds its events into a `ConversationReducer`, and does what the
/// Electron renderer's `agentEventService` did — publish the snapshot other
/// clients read, save chat history, drain the queue, title and notify.
///
/// Only a local backend gets one. A phone reads the snapshots this publishes.
@MainActor
@Observable
public final class LiveAgents {
  public struct Timing: Sendable {
    /// Coalesces bursts of events into one snapshot publish and history save.
    public var saveDebounce: Duration = .milliseconds(500)
    /// A question approved outright resolves within a tick; announcing it is noise.
    public var awaitingAnswerGrace: Duration = .milliseconds(750)
    /// A permission can land before its tool call is folded in; retry for ~1s.
    public var permissionRetryInterval: Duration = .milliseconds(50)
    public var permissionRetries = 20

    public init() {}
  }

  public private(set) var agents: [String: LiveAgent] = [:]
  public private(set) var conversations: [String: AgentConversation] = [:]

  @ObservationIgnored weak var store: HostStore?
  @ObservationIgnored let timing: Timing
  @ObservationIgnored let environment: ConversationEnvironment

  @ObservationIgnored var sessions: [String: LiveSession] = [:]
  /// The host's own status per agent; its `idle` transition ends a turn.
  @ObservationIgnored var hostStatus: [String: RemoteAgentState] = [:]
  /// Agents with a message sent but no idle back yet. Keeps overlapping drains
  /// from dispatching two queued messages into one turn.
  @ObservationIgnored var inflight: Set<String> = []
  @ObservationIgnored var finishedTurns: [String: FinishedTurn] = [:]
  @ObservationIgnored var saveTimers: [String: Task<Void, Never>] = [:]
  @ObservationIgnored var titleRequested: Set<String> = []
  @ObservationIgnored var notified = NotificationLedger()
  @ObservationIgnored var rowCache: [String: [String: CachedRow]] = [:]
  @ObservationIgnored private var dirty: Set<String> = []
  @ObservationIgnored private var flushScheduled = false

  init(store: HostStore, timing: Timing, environment: ConversationEnvironment) {
    self.store = store
    self.timing = timing
    self.environment = environment
  }

  var backend: (any HostBackend)? { store?.backend }

  // MARK: Reading

  public func conversation(for agentId: String) -> AgentConversation? {
    conversations[agentId]
  }

  /// Live agents grouped by session, oldest first.
  public var agentsBySession: [String: [LiveAgent]] {
    Dictionary(grouping: agents.values, by: \.sessionId)
      .mapValues { $0.sorted { $0.createdAt < $1.createdAt } }
  }

  public func agents(inSession sessionId: String) -> [LiveAgent] {
    agentsBySession[sessionId] ?? []
  }

  /// How far a session's setup or removal has got, from the host's last
  /// `session:progress`. Nil once it is ready.
  public func setupProgress(sessionId: String) -> RemoteSessionProgress? {
    guard let store else { return nil }
    for sessions in store.sessionsByRepo.values {
      if let session = sessions.first(where: { $0.id == sessionId }) { return session.progress }
    }
    return nil
  }

  // MARK: Discovery

  /// Find every agent the host is running and subscribe to each. Runs on
  /// attach and after every reconnect: subscriptions belong to a connection,
  /// so a new one starts with none.
  public func resync() async {
    guard let backend else { return }
    // Only agents known before asking can be judged gone by the answer: one
    // that starts while the request is in flight isn't in it yet.
    let knownBefore = Set(agents.keys)
    guard let snapshot = try? await backend.request(ArgusProtocol.Commands.StateHydrate.self, EmptyParams())
    else { return }
    adopt(sessions: snapshot.sessions)
    let live = Set(snapshot.agents.map(\.agentId))
    for info in snapshot.agents {
      let status = RemoteAgentState(rawValue: info.status.rawValue) ?? .idle
      if agents[info.agentId] == nil {
        agents[info.agentId] = LiveAgent(
          id: info.agentId, sessionId: info.sessionId, parentAgentId: info.parentAgentId,
          runnerId: info.runnerId, createdAt: info.createdAt, status: status, model: info.model)
      }
      hostStatus[info.agentId] = status
      await track(info.agentId)
    }
    // Gone while the connection was down: its exit was never heard.
    for (id, agent) in agents where knownBefore.contains(id) && !live.contains(id)
      && agent.status != .stopped && agent.status != .error
    {
      handleExit(id, code: 0)
    }
  }

  /// Subscribe, mirror the queue, and seed the transcript from the host's
  /// snapshot so a reconnect or a resumed agent keeps its turns.
  private func track(_ agentId: String) async {
    guard let backend, let store else { return }
    await backend.subscribe(agentId: agentId, on: true)
    await store.loadQueue(agentId: agentId)
    await hydrateFromSnapshot(agentId)
    markDirty(agentId)
  }

  func refreshSessions() async {
    guard let backend,
      let snapshot = try? await backend.request(ArgusProtocol.Commands.StateHydrate.self, EmptyParams())
    else { return }
    adopt(sessions: snapshot.sessions)
  }

  private func adopt(sessions list: [ArgusProtocol.Session]) {
    for s in list {
      sessions[s.id] = LiveSession(
        repoRoot: s.repoRoot, branch: s.branch, description: s.description,
        displayName: s.displayName)
    }
  }

  /// `agent:started`: an agent spawned anywhere — this app, the phone, MCP.
  func agentStarted(_ info: AgentStartedPayload) async {
    let id = info.agent_id
    guard agents[id] == nil else { return }
    let status = info.status.flatMap(RemoteAgentState.init(rawValue:)) ?? .idle
    agents[id] = LiveAgent(
      id: id, sessionId: info.session_id, parentAgentId: info.parent_agent_id,
      runnerId: info.runner_id, createdAt: info.created_at ?? environment.now(), status: status,
      model: info.model, permissionMode: info.permission_mode)
    hostStatus[id] = status
    if sessions[info.session_id] == nil { await refreshSessions() }
    // An agent spawned without a prompt is idle and waiting. Faking "running"
    // would strand it: nothing would ever settle it, so the queue never drains.
    if let prompt = info.initial_prompt {
      maybeGenerateTitle(id, firstMessage: prompt)
      // The host sends a prompted spawn's prompt before anyone subscribes; an
      // early idle mustn't settle the agent while it is still on it.
      inflight.insert(id)
      setStatus(id, .running)
    }
    await track(id)
  }

  /// Stop following an agent the app closed.
  public func forget(_ agentId: String) async {
    await save(agentId)
    agents[agentId] = nil
    conversations[agentId] = nil
    hostStatus[agentId] = nil
    inflight.remove(agentId)
    finishedTurns[agentId] = nil
    rowCache[agentId] = nil
    titleRequested.remove(agentId)
    await backend?.subscribe(agentId: agentId, on: false)
  }

  // MARK: Reducer access

  /// Run `body` against the agent's reducer and republish the result.
  @discardableResult
  func mutate<T>(_ agentId: String, _ body: (inout ConversationReducer) -> T) -> T {
    var reducer = ConversationReducer(
      conversation: conversations.removeValue(forKey: agentId), environment: environment)
    let result = body(&reducer)
    conversations[agentId] = reducer.conversation
    markDirty(agentId)
    return result
  }

  func setStatus(_ agentId: String, _ status: RemoteAgentState) {
    if agents[agentId]?.status != status { agents[agentId]?.status = status }
    store?.overlayLiveStatus(agentId)
  }

  func updateAgent(_ agentId: String, _ body: (inout LiveAgent) -> Void) {
    guard var agent = agents[agentId] else { return }
    body(&agent)
    if agent != agents[agentId] { agents[agentId] = agent }
  }

  // MARK: Projection

  /// A burst of reducer changes becomes one rebuild of the store's rows.
  func markDirty(_ agentId: String) {
    dirty.insert(agentId)
    guard !flushScheduled else { return }
    flushScheduled = true
    Task { @MainActor [weak self] in self?.flush() }
  }

  private func flush() {
    flushScheduled = false
    let ids = dirty
    dirty.removeAll()
    for id in ids { project(id) }
  }

  /// Push the conversation into the store as the phone's transcript rows,
  /// reusing rows whose message didn't change so views keep their identity.
  func project(_ agentId: String) {
    guard let store, let conv = conversations[agentId] else { return }
    let cache = rowCache[agentId] ?? [:]
    var next: [String: CachedRow] = [:]
    let rows = conv.messages.compactMap { message -> RemoteMessage? in
      if let hit = cache[message.id], hit.source == message {
        next[message.id] = hit
        return hit.row
      }
      guard let row = try? RemoteTranscriptBuilder.message(message) else { return nil }
      next[message.id] = CachedRow(source: message, row: row)
      return row
    }
    rowCache[agentId] = next
    let tasks: [RemoteTask]? = try? RemoteTranscriptBuilder.decode(
      RemoteTranscriptBuilder.tasksJSON(conv))
    let todos: [RemoteTodo]? = try? RemoteTranscriptBuilder.decode(
      RemoteTranscriptBuilder.todosJSON(conv))
    store.applyLiveTranscript(
      agentId, messages: rows, tasks: tasks, todos: todos,
      pendingToolName: conv.pendingToolName?.value)
  }
}

struct CachedRow {
  let source: ConversationMessage
  let row: RemoteMessage
}

/// Prompts already announced, so whichever path notices first wins. Bounded —
/// a long session would otherwise keep every prompt it ever raised.
struct NotificationLedger {
  private var order: [String] = []
  private var seen: Set<String> = []

  mutating func claim(_ key: String) -> Bool {
    guard seen.insert(key).inserted else { return false }
    order.append(key)
    if order.count > 500 { seen.remove(order.removeFirst()) }
    return true
  }
}
