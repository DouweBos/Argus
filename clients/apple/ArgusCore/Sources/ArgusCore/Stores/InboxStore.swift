import ArgusKit
import Foundation
import Observation

/// The desktop inbox in full: every proposal and run as the host's catalog
/// holds them. The gateway's narrowed shapes drop what the desktop shows —
/// why a proposal was cleared, the revision asked for, whether a failed run
/// was looked at — so this needs an admin-tier backend: the Mac's socket.
///
/// The host pushes the whole proposal list on `proposals:changed` and each run
/// on `automation_run:changed`; feed them to `ipc(channel:args:)`.
@MainActor
@Observable
public final class InboxStore {
  public typealias Proposal = ArgusProtocol.Proposal
  public typealias Run = ArgusProtocol.AutomationRun

  /// Newest first.
  public internal(set) var proposals: [Proposal] = []
  /// Newest first, every automation's and every quick run's.
  public internal(set) var runs: [Run] = []
  public internal(set) var loaded = false
  public internal(set) var error: String?
  /// A dismiss, resolve, revision or cleanup in flight — the card dims.
  public internal(set) var busy: Set<String> = []
  /// Starts asked for here and not yet answered.
  public internal(set) var starting: Set<String> = []
  /// Why a start request was refused before it reached the proposal record.
  public internal(set) var refusals: [String: String] = [:]

  private unowned let host: HostStore

  public init(host: HostStore) {
    self.host = host
  }

  public func clear() {
    proposals = []
    runs = []
    loaded = false
    error = nil
    busy = []
    starting = []
    refusals = [:]
  }

  public func proposal(id: String) -> Proposal? {
    proposals.first { $0.id == id }
  }

  public func items(sessionIds: Set<String>, now: Date = Date()) -> InboxItems {
    InboxItems(
      proposals: proposals, runs: runs, sessionIds: sessionIds,
      now: now.timeIntervalSince1970 * 1000)
  }

  public func refresh() async {
    guard let backend = host.backend else { return }
    async let listed = try? backend.request(
      ArgusProtocol.Commands.ProposalsList.self, .init())
    async let ran = try? backend.request(
      ArgusProtocol.Commands.AutomationRunsList.self, .init())
    let (proposals, runs) = await (listed, ran)
    if let proposals { self.proposals = Self.newestFirst(proposals) }
    if let runs { self.runs = runs.sorted { $0.startedAt > $1.startedAt } }
    loaded = true
    error = proposals == nil && runs == nil ? "Couldn't read the inbox." : nil
  }

  /// A host broadcast. Returns whether it was one of the inbox's.
  @discardableResult
  public func ipc(channel: String, args: [JSONValue]) -> Bool {
    switch channel {
    case "proposals:changed":
      guard let payload = args.first,
        let list = try? ProtocolCodec.convert(payload, to: [Proposal].self)
      else { return true }
      proposals = Self.newestFirst(list)
    case "automation_run:changed":
      // Null means runs were removed in bulk; only a refetch knows which.
      guard let payload = args.first, payload != .null,
        let run = try? ProtocolCodec.convert(payload, to: Run.self)
      else {
        Task { await refresh() }
        return true
      }
      upsert(run)
    default:
      return false
    }
    return true
  }

  // MARK: Proposals

  /// Creates the proposal's session and starts its agent, with your note in
  /// its brief. Building a session can outlast a request: a timeout means it
  /// is still going, and `start_stage` on the proposal says where.
  public func start(id: String, note: String?) async -> ArgusProtocol.AcceptProposalResult? {
    guard let backend = host.backend else { return nil }
    starting.insert(id)
    refusals[id] = nil
    defer { starting.remove(id) }
    do {
      let result = try await backend.request(
        ArgusProtocol.Commands.ProposalAccept.self, .init(id: id, note: note))
      host.hooks.track(.proposalHandled(action: .accept))
      replace(result.proposal)
      return result
    } catch Transport.TransportError.timedOut {
      host.hooks.track(.proposalHandled(action: .accept))
      return nil
    } catch {
      refusals[id] = HostStore.describe(error)
      host.hooks.errorReported(error, "proposals")
      return nil
    }
  }

  /// Ask the automation for a better one. The proposal stays put: its next
  /// run answers by superseding or withdrawing it.
  @discardableResult
  public func requestRevision(id: String, note: String) async -> Bool {
    await act(id, .requestRevision, "Couldn't ask for a revision") { backend in
      try await backend.request(
        ArgusProtocol.Commands.ProposalRequestRevision.self, .init(id: id, note: note)
      ).proposal
    }
  }

  /// The reason is what calibrates the automation, so it is never required.
  @discardableResult
  public func dismiss(id: String, reason: String?) async -> Bool {
    await act(id, .dismiss, "Couldn't dismiss that proposal") { backend in
      try await backend.request(
        ArgusProtocol.Commands.ProposalDismiss.self, .init(id: id, reason: reason))
    }
  }

  /// You did it yourself — agreement, not a dismissal.
  @discardableResult
  public func resolve(id: String, note: String?) async -> Bool {
    await act(id, .resolve, "Couldn't mark that proposal done") { backend in
      try await backend.request(
        ArgusProtocol.Commands.ProposalResolve.self, .init(id: id, note: note))
    }
  }

  /// A cleanup CTA: deletes a branch or a session. The caller confirms first.
  @discardableResult
  public func cleanup(id: String) async -> Bool {
    await act(id, .cleanup, "Couldn't run that cleanup") { backend in
      try await backend.request(
        ArgusProtocol.Commands.ProposalPerformCleanup.self, .init(id: id))
    }
  }

  // MARK: Runs

  /// Dismissing a failure or a report is reading it; neither asks for a reason.
  public func markRunRead(id: String) async {
    guard let backend = host.backend else { return }
    do {
      upsert(
        try await backend.request(ArgusProtocol.Commands.AutomationRunMarkRead.self, .init(runId: id)))
      host.hooks.track(.runActed(action: .markRead))
    } catch {
      fail("Couldn't mark that run read", error)
    }
  }

  private func act(
    _ id: String, _ action: StoreEvent.ProposalAction, _ summary: String,
    _ request: (any HostBackend) async throws -> Proposal
  ) async -> Bool {
    guard let backend = host.backend else { return false }
    busy.insert(id)
    defer { busy.remove(id) }
    do {
      replace(try await request(backend))
      host.hooks.track(.proposalHandled(action: action))
      error = nil
      return true
    } catch {
      fail(summary, error)
      return false
    }
  }

  private func replace(_ proposal: Proposal) {
    if let index = proposals.firstIndex(where: { $0.id == proposal.id }) {
      proposals[index] = proposal
    } else {
      proposals = Self.newestFirst(proposals + [proposal])
    }
  }

  private func upsert(_ run: Run) {
    if let index = runs.firstIndex(where: { $0.id == run.id }) {
      runs[index] = run
    } else {
      runs.insert(run, at: runs.firstIndex { $0.startedAt < run.startedAt } ?? runs.endIndex)
    }
  }

  private static func newestFirst(_ proposals: [Proposal]) -> [Proposal] {
    proposals.sorted { $0.createdAt > $1.createdAt }
  }

  private func fail(_ summary: String, _ error: Error) {
    guard !HostStore.isCancellation(error) else { return }
    self.error = "\(summary) — \(HostStore.describe(error))"
    host.hooks.errorReported(error, "proposals")
  }
}
