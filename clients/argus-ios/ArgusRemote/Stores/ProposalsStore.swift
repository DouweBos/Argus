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

  private unowned let app: AppStore

  init(app: AppStore) {
    self.app = app
  }

  func clear() {
    proposals = []
    busy = []
    loaded = false
    error = nil
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
    }
    loaded = true
  }

  /// Accepting spawns the agent that does the work; the caller opens it.
  func accept(id: String) async -> String? {
    guard let transport = app.transport else { return nil }
    busy.insert(id)
    defer { busy.remove(id) }

    struct Params: Encodable { let proposal_id: String }
    struct Result: Decodable { let agent_id: String? }
    do {
      let result = try await transport.request(
        .proposalsAccept, Params(proposal_id: id), as: Result.self)
      // Building the worktree is slow; drop the card now rather than leaving
      // it sitting there looking undecided.
      proposals.removeAll { $0.id == id }
      return result.agent_id
    } catch {
      fail("Couldn't start that proposal", error)
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
    } catch {
      fail("Couldn't run that cleanup", error)
    }
    await refresh()
  }

  /// Show it, and send it — a failure the user sees is one worth knowing
  /// about, scrubbed of anything from their work.
  private func fail(_ summary: String, _ error: Error) {
    self.error = "\(summary) — \(AppStore.describe(error))"
    Telemetry.capture(.appError(scope: "proposals", message: AppStore.describe(error)))
    Telemetry.captureException(error, source: "app_error", extra: ["scope": "proposals"])
  }
}
