import ArgusKit
import Foundation

/// Reading a computer that isn't there: its saved answers stand in for the
/// connection, and replies wait in an outbox until it comes back.
extension HostStore {

  /// The connection itself, without the saved answers in front of it.
  public var liveBackend: (any HostBackend)? {
    guard let saving = backend as? SavingBackend else { return backend }
    return saving.live
  }

  /// Off the connection with saved answers to read: screens that only poll
  /// while connected load once from those instead.
  public var readsSaved: Bool { connection != .ready && savedAnswers != nil }

  /// Offline, what's held already came from the connection or from deltas
  /// since; a saved answer would only be older.
  func holdsFresher(_ held: Bool) -> Bool {
    held && connection != .ready
  }

  /// Read and reply to this computer offline from now on. Until a connection
  /// attaches, what's on screen comes from what was saved.
  public func openOffline(saved: SavedAnswers?, outbox: Outbox?) async {
    savedAnswers = saved
    self.outbox = outbox
    savedAsOf = nil
    outboxByAgent = Dictionary(grouping: outbox?.load() ?? [], by: \.agentId).mapValues { $0.map(\.message) }
    guard let saved, liveBackend == nil else { return }
    backend = offlineBackend(saved)
    // The home screen polls its lists only while connected.
    await BackgroundRefresh.run {
      await refreshProjects()
      await loadRecentAgents()
      await loadScratchPads()
    }
  }

  func wrapForOffline(_ live: any HostBackend) -> any HostBackend {
    guard let savedAnswers else { return live }
    return SavingBackend(live: live, saved: savedAnswers, servedSaved: servedSavedHandler)
  }

  func offlineBackend(_ saved: SavedAnswers) -> SavingBackend {
    SavingBackend(live: nil, saved: saved, servedSaved: servedSavedHandler)
  }

  private var servedSavedHandler: @Sendable (Date) -> Void {
    { [weak self] date in Task { @MainActor in self?.servedSaved(at: date) } }
  }

  /// The oldest answer on screen sets the age shown, so it never reads fresher than it is.
  private func servedSaved(at date: Date) {
    guard connection != .ready else { return }
    if savedAsOf.map({ date < $0 }) ?? true { savedAsOf = date }
  }

  // MARK: Outbox

  /// Whether a reply should wait for the connection rather than be tried now.
  var shouldHoldReply: Bool {
    outbox != nil && (liveBackend == nil || connection != .ready)
  }

  func holdReply(agentId: String, message: String, displayText: String?, images: [RemoteImageAttachment]) {
    let held = FailedSend(
      id: "outbox-\(UUID().uuidString)", body: message, displayText: displayText, images: images)
    outboxByAgent[agentId, default: []].append(held)
    persistOutbox(adding: [held.id: Date()])
    hooks.track(.offlineReply(action: .queued))
  }

  public func discardHeld(agentId: String, id: String) {
    outboxByAgent[agentId]?.removeAll { $0.id == id }
    if outboxByAgent[agentId]?.isEmpty == true { outboxByAgent[agentId] = nil }
    persistOutbox()
    hooks.track(.offlineReply(action: .discarded))
  }

  /// Send what waited, oldest first. One at a time and once: a second
  /// connection arriving mid-flush must not send anything twice.
  func flushOutbox() {
    guard outbox != nil, !outboxFlushing, connection == .ready, liveBackend != nil else { return }
    let entries = outbox?.load() ?? []
    guard !entries.isEmpty else { return }
    outboxFlushing = true
    Task {
      defer { outboxFlushing = false }
      for entry in entries.sorted(by: { $0.at < $1.at }) {
        guard connection == .ready else { return }
        outboxByAgent[entry.agentId]?.removeAll { $0.id == entry.message.id }
        if outboxByAgent[entry.agentId]?.isEmpty == true { outboxByAgent[entry.agentId] = nil }
        persistOutbox()
        hooks.track(.offlineReply(action: .replayed))
        await sendMessage(
          agentId: entry.agentId, message: entry.message.body, images: entry.message.images,
          displayText: entry.message.displayText)
      }
    }
  }

  /// Write the outbox as it stands, keeping each entry's original time.
  private func persistOutbox(adding times: [String: Date] = [:]) {
    guard let outbox else { return }
    let known = Dictionary(outbox.load().map { ($0.message.id, $0.at) }, uniquingKeysWith: { a, _ in a })
    let entries = outboxByAgent.flatMap { agentId, messages in
      messages.map { message in
        Outbox.Entry(agentId: agentId, message: message, at: known[message.id] ?? times[message.id] ?? Date())
      }
    }
    outbox.save(entries.sorted { $0.at < $1.at })
  }
}
