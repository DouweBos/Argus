import ArgusCore
import ArgusKit
import Foundation
import Observation

/// Proposing a project config (stored on this Mac) for a project that has none: inferred from the
/// repo, optionally refined by Claude, reviewed, then written — the desktop's
/// "Finish setting up this project" flow.
@MainActor
@Observable
final class ArgusJsonGenerator {
  enum Phase: Equatable {
    case loading
    /// The repo already has one; nothing to generate.
    case existing
    case choosing
    case generatingQuick
    case generatingClaude
    case reviewing
    case saving
    case saved
  }

  enum Source: String {
    case quick, claude, conductor

    var telemetry: MacTelemetryEvent.ArgusJsonMethod {
      switch self {
      case .quick: .quick
      case .claude: .claude
      case .conductor: .conductor
      }
    }
  }

  let repoRoot: String
  private(set) var phase = Phase.loading
  private(set) var existing: [String: JSONValue]?
  private(set) var proposed: [String: JSONValue]?
  private(set) var source = Source.quick
  private(set) var signals: [ArgusProtocol.DetectedSignal] = []
  private(set) var inferredFrom: [String] = []
  /// The repo's Conductor scripts as a project config, when it has any.
  private(set) var conductor: ArgusProtocol.ConductorImport?
  /// What the Conductor import couldn't carry over.
  private(set) var notes: [String] = []
  private(set) var error: String?

  init(repoRoot: String) {
    self.repoRoot = repoRoot
  }

  var isBusy: Bool { [.generatingQuick, .generatingClaude, .saving].contains(phase) }
  var proposedText: String { ConfigJSON.string(.object(proposed ?? [:])) }

  func load(_ backend: HostRouter) async {
    let found = try? await backend.request(
      ArgusProtocol.Commands.OnboardingReadExistingArgusJson.self, .init(path: repoRoot))
    existing = found ?? nil
    if existing == nil {
      conductor = (try? await backend.request(
        ArgusProtocol.Commands.OnboardingImportConductorConfig.self, .init(path: repoRoot))) ?? nil
    }
    phase = existing == nil ? .choosing : .existing
  }

  /// Conductor's setup script and run actions, already converted on load.
  func importConductor() {
    guard let conductor else { return }
    error = nil
    proposed = conductor.suggestion.config
    signals = conductor.suggestion.signals
    inferredFrom = conductor.suggestion.inferredFrom
    notes = conductor.notes
    source = .conductor
    phase = .reviewing
  }

  /// Fast, no network: package.json, lockfiles, platform dirs.
  func quick(_ backend: HostRouter) async {
    phase = .generatingQuick
    error = nil
    do {
      try await suggest(backend)
      source = .quick
      phase = .reviewing
    } catch {
      fail(error, method: .quick)
    }
  }

  /// Runs the Claude CLI in the repo over the inferred config (~30–90s).
  func claude(_ backend: HostRouter) async {
    phase = .generatingClaude
    error = nil
    do {
      try await suggest(backend)
      proposed = try await backend.request(
        ArgusProtocol.Commands.OnboardingRefineArgusJsonWithClaude.self,
        .init(path: repoRoot, config: proposed ?? [:]))
      source = .claude
      phase = .reviewing
    } catch {
      fail(error, method: .claude)
    }
  }

  func save(_ backend: HostRouter) async {
    guard let proposed else { return }
    phase = .saving
    error = nil
    do {
      try await backend.request(
        ArgusProtocol.Commands.OnboardingWriteArgusJson.self, .init(path: repoRoot, config: proposed))
      MacTelemetry.capture(.argusJsonGenerated(method: source.telemetry, outcome: .saved))
      phase = .saved
    } catch {
      self.error = HostStore.describe(error)
      phase = .reviewing
    }
  }

  func discard() {
    MacTelemetry.capture(.argusJsonGenerated(method: source.telemetry, outcome: .discarded))
    proposed = nil
    notes = []
    error = nil
    phase = .choosing
  }

  private func suggest(_ backend: HostRouter) async throws {
    let suggestion = try await backend.request(
      ArgusProtocol.Commands.OnboardingSuggestArgusJson.self, .init(path: repoRoot))
    proposed = suggestion.config
    signals = suggestion.signals
    inferredFrom = suggestion.inferredFrom
    notes = []
  }

  private func fail(_ error: Error, method: MacTelemetryEvent.ArgusJsonMethod) {
    MacTelemetry.capture(.argusJsonGenerated(method: method, outcome: .failed))
    self.error = HostStore.describe(error)
    phase = .choosing
  }
}
