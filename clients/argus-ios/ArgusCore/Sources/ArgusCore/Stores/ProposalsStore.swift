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
final class ProposalsStore {
  var proposals: [RemoteProposal] = []
  var busy: Set<String> = []
  var loaded = false
  var error: String?
  /// Accept requests still waiting on an answer, before any stage is known.
  var requesting: Set<String> = []
  /// Why an accept request itself failed; the host's `startError` covers
  /// anything that goes wrong after it answered.
  var requestErrors: [String: String] = [:]
  /// Started from this phone and now running, kept until opened or closed.
  var started: [RemoteProposal] = []
  /// Started from this phone and still being set up, so a card that leaves the
  /// pending list can be told apart from one dismissed elsewhere.
  private var starting: Set<String> = []

  private unowned let app: AppStore

  init(app: AppStore) {
    self.app = app
  }

  func clear() {
    proposals = []
    busy = []
    loaded = false
    error = nil
    requesting = []
    requestErrors = [:]
    started = []
    starting = []
  }

  func refresh() async {
    guard let transport = app.transport else { return }
    struct Params: Encodable { let status: String }
    struct Result: Decodable { let proposals: [RemoteProposal] }
    do {
      let result = try await transport.request(
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
    guard !gone.isEmpty, let transport = app.transport else { return }

    struct Params: Encodable {
      let status: String
      let limit: Int
    }
    struct Result: Decodable { let proposals: [RemoteProposal] }
    // Best effort: a miss is retried on the next refresh.
    guard
      let result = try? await transport.request(
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
  func isStarting(_ proposal: RemoteProposal) -> Bool {
    requesting.contains(proposal.id) || proposal.startStage != nil
      || (starting.contains(proposal.id) && proposal.startError == nil)
  }

  func closeStarted(id: String) {
    started.removeAll { $0.id == id }
  }

  /// The host answers once the start is under way, and only has an agent to
  /// hand back when it finished inside that window; the caller opens it then.
  func accept(id: String) async -> String? {
    guard let transport = app.transport else { return nil }
    requesting.insert(id)
    requestErrors[id] = nil
    defer { requesting.remove(id) }

    struct Params: Encodable { let proposal_id: String }
    struct Result: Decodable {
      let proposal: RemoteProposal
      let agent_id: String?
    }
    do {
      let result = try await transport.request(
        .proposalsAccept, Params(proposal_id: id), as: Result.self)
      Telemetry.capture(.proposalHandled(action: .accept))
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
      requestErrors[id] = AppStore.describe(error)
      report(error)
      return nil
    }
  }

  func dismiss(id: String, reason: String?) async {
    guard let transport = app.transport else { return }
    busy.insert(id)
    defer { busy.remove(id) }

    struct Params: Encodable {
      let proposal_id: String
      let reason: String?
    }
    do {
      try await transport.request(
        .proposalsDismiss, Params(proposal_id: id, reason: reason), as: IgnoredResult.self)
      Telemetry.capture(.proposalHandled(action: .dismiss))
    } catch {
      fail("Couldn't dismiss that proposal", error)
    }
    await refresh()
  }

  /// You already did what it asked — the opposite signal from a dismissal.
  func resolve(id: String, note: String?) async {
    guard let transport = app.transport else { return }
    busy.insert(id)
    defer { busy.remove(id) }

    struct Params: Encodable {
      let proposal_id: String
      let note: String?
    }
    do {
      try await transport.request(
        .proposalsResolve, Params(proposal_id: id, note: note), as: IgnoredResult.self)
      Telemetry.capture(.proposalHandled(action: .resolve))
    } catch {
      fail("Couldn't mark that proposal done", error)
    }
    await refresh()
  }

  func performCleanup(id: String) async {
    guard let transport = app.transport else { return }
    busy.insert(id)
    defer { busy.remove(id) }

    struct Params: Encodable { let proposal_id: String }
    do {
      try await transport.request(
        .proposalsPerformCleanup, Params(proposal_id: id), as: IgnoredResult.self)
      Telemetry.capture(.proposalHandled(action: .cleanup))
    } catch {
      fail("Couldn't run that cleanup", error)
    }
    await refresh()
  }

  /// Show it, and send it — a failure the user sees is one worth knowing
  /// about, scrubbed of anything from their work.
  private func fail(_ summary: String, _ error: Error) {
    self.error = "\(summary) — \(AppStore.describe(error))"
    report(error)
  }

  private func report(_ error: Error) {
    Telemetry.capture(.appError(scope: "proposals", message: AppStore.describe(error)))
    Telemetry.captureException(error, source: "app_error", extra: ["scope": "proposals"])
  }
}
