import ArgusKit
import Foundation
import Observation

/// The inbox: what the computer's automations are proposing.
///
/// Reading is `monitor`; starting and dismissing need `control`, because
/// starting one builds a worktree and puts an agent in it, and the dismiss
/// reason is what calibrates the automation.
@MainActor
@Observable
public final class ProposalsStore {
  public internal(set) var proposals: [RemoteProposal] = []
  public internal(set) var busy: Set<String> = []
  public internal(set) var loaded = false
  public internal(set) var error: String?
  /// Accept requests still waiting on an answer, before any stage is known.
  public internal(set) var requesting: Set<String> = []
  /// Why an accept request itself failed; the host's `startError` covers
  /// anything that goes wrong after it answered.
  public internal(set) var requestErrors: [String: String] = [:]
  /// Started from this phone and now running, kept until opened or closed.
  public internal(set) var started: [RemoteProposal] = []
  /// Proposals opened on their own screen, decided ones included.
  public internal(set) var detailById: [String: RemoteProposal] = [:]
  /// Started from this phone and still being set up, so a card that leaves the
  /// pending list can be told apart from one dismissed elsewhere.
  private var starting: Set<String> = []

  private unowned let host: HostStore

  public init(host: HostStore) {
    self.host = host
  }

  public func clear() {
    proposals = []
    busy = []
    loaded = false
    error = nil
    requesting = []
    requestErrors = [:]
    started = []
    starting = []
    detailById = [:]
  }

  /// One proposal in full, for its own screen. Nil when it is gone; an older
  /// computer without `proposals.get` falls back to the pending list.
  @discardableResult
  public func load(id: String) async -> RemoteProposal? {
    guard let backend = host.backend else { return detailById[id] }
    struct Params: Encodable { let proposal_id: String }
    struct Result: Decodable { let proposal: RemoteProposal }
    do {
      let result = try await backend.request(
        .proposalsGet, Params(proposal_id: id), as: Result.self)
      detailById[id] = result.proposal
    } catch let error as Transport.TransportError {
      if case .gateway(let payload) = error, payload.isNotFound {
        detailById[id] = nil
      } else if let pending = proposals.first(where: { $0.id == id }) {
        detailById[id] = pending
      }
    } catch {
      report(error)
    }
    return detailById[id]
  }

  /// Ask the automation to rework it. Returns whether a run started now; a
  /// note the next run picks up is just as good.
  public func requestRevision(id: String, note: String) async -> Bool? {
    guard let backend = host.backend else { return nil }
    busy.insert(id)
    defer { busy.remove(id) }

    struct Params: Encodable {
      let proposal_id: String
      let note: String
    }
    struct Result: Decodable {
      let proposal: RemoteProposal
      let run_started: Bool
    }
    do {
      let result = try await backend.request(
        .proposalsRequestRevision, Params(proposal_id: id, note: note), as: Result.self)
      host.hooks.track(.proposalHandled(action: .requestRevision))
      detailById[id] = result.proposal
      await refresh()
      return result.run_started
    } catch {
      fail("Couldn't ask for a revision", error)
      return nil
    }
  }

  public func refresh() async {
    guard let backend = host.backend else { return }
    struct Params: Encodable { let status: String }
    struct Result: Decodable { let proposals: [RemoteProposal] }
    do {
      let result = try await backend.request(
        .proposalsList, Params(status: "pending"), as: Result.self)
      proposals = result.proposals
      error = nil
    } catch {
      fail("Couldn't read the inbox", error)
      loaded = true
      return
    }
    loaded = true
    await followStarts()
  }

  /// Keep up with starts this phone made: a failed one stays pending with its
  /// error, a finished one drops out of the pending list as `accepted`.
  private func followStarts() async {
    for proposal in proposals {
      // An accept that timed out on the phone may still have got through.
      if proposal.startStage != nil, requestErrors.removeValue(forKey: proposal.id) != nil {
        starting.insert(proposal.id)
      }
      if proposal.startError != nil { starting.remove(proposal.id) }
    }
    let pendingIds = Set(proposals.map(\.id))
    let gone = starting.subtracting(pendingIds)
    guard !gone.isEmpty, let backend = host.backend else { return }

    struct Params: Encodable {
      let status: String
      let limit: Int
    }
    struct Result: Decodable { let proposals: [RemoteProposal] }
    // Best effort: a miss is retried on the next refresh.
    guard
      let result = try? await backend.request(
        .proposalsList, Params(status: "accepted", limit: 100), as: Result.self)
    else { return }
    for id in gone {
      starting.remove(id)
      // Not there means it was dismissed or resolved elsewhere: nothing to open.
      guard let done = result.proposals.first(where: { $0.id == id }), done.agentId != nil,
        !started.contains(where: { $0.id == id })
      else { continue }
      started.append(done)
    }
  }

  /// Whether the card should show progress. A refresh that raced the accept
  /// can hand back the proposal without its stage, so the local record counts.
  public func isStarting(_ proposal: RemoteProposal) -> Bool {
    requesting.contains(proposal.id) || proposal.startStage != nil
      || (starting.contains(proposal.id) && proposal.startError == nil)
  }

  public func closeStarted(id: String) {
    started.removeAll { $0.id == id }
  }

  /// The host answers once the start is under way, and only has an agent to
  /// hand back when it finished inside that window; the caller opens it then.
  public func accept(id: String, note: String? = nil) async -> String? {
    guard let backend = host.backend else { return nil }
    requesting.insert(id)
    requestErrors[id] = nil
    defer { requesting.remove(id) }

    struct Params: Encodable {
      let proposal_id: String
      let note: String?
    }
    struct Result: Decodable {
      let proposal: RemoteProposal
      let agent_id: String?
    }
    let note = note?.trimmingCharacters(in: .whitespacesAndNewlines)
    do {
      let result = try await backend.request(
        .proposalsAccept, Params(proposal_id: id, note: note?.isEmpty == false ? note : nil),
        as: Result.self)
      detailById[id] = result.proposal
      host.hooks.track(.proposalHandled(action: .accept))
      if let agentId = result.agent_id {
        proposals.removeAll { $0.id == id }
        return agentId
      }
      // The returned proposal carries its stage, so the card shows progress now.
      if let index = proposals.firstIndex(where: { $0.id == id }) {
        proposals[index] = result.proposal
      }
      starting.insert(id)
      return nil
    } catch {
      // Shown on the card rather than the banner: it is about that one.
      requestErrors[id] = HostStore.describe(error)
      report(error)
      return nil
    }
  }

  public func dismiss(id: String, reason: String?) async {
    guard let backend = host.backend else { return }
    busy.insert(id)
    defer { busy.remove(id) }

    struct Params: Encodable {
      let proposal_id: String
      let reason: String?
    }
    do {
      try await backend.request(
        .proposalsDismiss, Params(proposal_id: id, reason: reason), as: IgnoredResult.self)
      host.hooks.track(.proposalHandled(action: .dismiss))
    } catch {
      fail("Couldn't dismiss that proposal", error)
    }
    await refresh()
  }

  /// You already did what it asked — the opposite signal from a dismissal.
  public func resolve(id: String, note: String?) async {
    guard let backend = host.backend else { return }
    busy.insert(id)
    defer { busy.remove(id) }

    struct Params: Encodable {
      let proposal_id: String
      let note: String?
    }
    do {
      try await backend.request(
        .proposalsResolve, Params(proposal_id: id, note: note), as: IgnoredResult.self)
      host.hooks.track(.proposalHandled(action: .resolve))
    } catch {
      fail("Couldn't mark that proposal done", error)
    }
    await refresh()
  }

  public func performCleanup(id: String) async {
    guard let backend = host.backend else { return }
    busy.insert(id)
    defer { busy.remove(id) }

    struct Params: Encodable { let proposal_id: String }
    do {
      try await backend.request(
        .proposalsPerformCleanup, Params(proposal_id: id), as: IgnoredResult.self)
      host.hooks.track(.proposalHandled(action: .cleanup))
    } catch {
      fail("Couldn't run that cleanup", error)
    }
    await refresh()
  }

  /// Show it, and send it — a failure the user sees is one worth knowing
  /// about, scrubbed of anything from their work.
  private func fail(_ summary: String, _ error: Error) {
    guard !HostStore.isCancellation(error) else { return }
    self.error = "\(summary) — \(HostStore.describe(error))"
    report(error)
  }

  private func report(_ error: Error) {
    host.hooks.errorReported(error, "proposals")
  }
}
