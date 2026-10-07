import ArgusCore
import ArgusKit
import Foundation
import Observation

/// Environment check results, shared by the first run and the home cards.
/// `claude_auth` shells out to the CLI, so the checks run once per launch and
/// afterwards only when asked, as on the desktop.
@MainActor
@Observable
final class PrereqChecks {
  static let shared = PrereqChecks()

  private(set) var results: [PrereqId: PrereqResult] = [:] {
    didSet { verdicts.merge(results.filter { $0.value.status != .running }) { $1 } }
  }
  /// The last finished result per check: a re-check keeps showing it until a
  /// new one lands, so a card doesn't blink out and back while it runs.
  private(set) var verdicts: [PrereqId: PrereqResult] = [:]
  private(set) var running = false
  private(set) var ran = false
  private(set) var fixing: PrereqId?
  private(set) var fixError: String?
  @ObservationIgnored private var stopEvents: (() -> Void)?

  /// Live progress: the host streams each check's result as it lands.
  func listen(_ store: HostStore) {
    guard stopEvents == nil else { return }
    stopEvents = store.observeIpc { [weak self] channel, args, _ in
      guard let self, let arg = args.first else { return }
      switch channel {
      case "onboarding:prereq_update":
        if let result = try? ProtocolCodec.convert(arg, to: PrereqResult.self) {
          results[result.id] = result
        }
      case "claude-auth:accounts-changed":
        // Signing in or switching moves the auth card; re-probe rather than trust it.
        if ran, let backend = store.backend as? HostRouter {
          Task { await self.run(backend, ids: [.claudeAuth], force: true) }
        }
      default: break
      }
    }
  }

  /// Runs `ids`, plus any core check that has never reported, so a targeted
  /// run can't leave a card without a verdict.
  func run(_ backend: HostRouter, ids: [PrereqId] = SetupChecks.core, force: Bool = false) async {
    guard !running, force || !ran else { return }
    running = true
    defer { running = false }
    let missing = SetupChecks.core.filter { results[$0] == nil }
    let all = Array(Set(ids + missing))
    for id in all where results[id] == nil {
      results[id] = PrereqResult(id: id, status: .running)
    }
    do {
      let found = try await backend.request(ArgusProtocol.Commands.OnboardingCheckPrereqs.self, .init(ids: all))
      for result in found { results[result.id] = result }
      ran = true
    } catch {
      for id in all where results[id]?.status == .running { results[id] = nil }
    }
  }

  /// One-click fixer, then a re-check of that one.
  func fix(_ backend: HostRouter, _ id: PrereqId, gitName: String? = nil, gitEmail: String? = nil) async {
    fixing = id
    fixError = nil
    defer { fixing = nil }
    let outcome = try? await backend.request(
      ArgusProtocol.Commands.OnboardingRunFixer.self, .init(id: id, gitName: gitName, gitEmail: gitEmail))
    if outcome?.ok != true { fixError = outcome?.error ?? "The fix didn't finish." }
    MacTelemetry.capture(.prereqFixed(prereq: id.rawValue, success: outcome?.ok == true))
    await run(backend, ids: [id], force: true)
  }

  var cards: [SetupChecks.Card] { SetupChecks.cards(verdicts) }
}
