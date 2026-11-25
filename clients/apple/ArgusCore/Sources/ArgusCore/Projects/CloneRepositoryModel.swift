import ArgusKit
import Foundation
import Observation

/// Clone Repository: an address, a folder on the computer and a name, checked
/// by the host as they're typed, then the clone's live progress. Shared by
/// the Mac sheet and the phone screen.
@MainActor
@Observable
public final class CloneRepositoryModel {
  public typealias Job = ArgusProtocol.CloneJob
  private typealias Methods = ArgusProtocol.Methods

  public var url = ""
  public var parentDir = ""
  /// Empty uses the repository's own name.
  public var name = ""
  public internal(set) var defaults: ArgusProtocol.CloneDefaults?
  public internal(set) var preview: ArgusProtocol.ClonePreview?
  public internal(set) var cloneId: String?
  public internal(set) var starting = false
  public internal(set) var error: String?

  /// Held strongly: a screen can outlive the connection it was opened on.
  public let host: HostStore

  public init(host: HostStore, cloneId: String? = nil) {
    self.host = host
    self.cloneId = cloneId
  }

  /// The clone this sheet started, as the latest event left it.
  public var job: Job? { cloneId.flatMap { host.clones[$0] } }

  public var isRunning: Bool { job?.status == .running }

  /// Folders worth offering, the current one first.
  public var parentChoices: [String] {
    var seen = Set<String>()
    return ([parentDir] + (defaults?.parents ?? [])).filter { !$0.isEmpty && seen.insert($0).inserted }
  }

  /// The name the folder gets when the field is left empty.
  public var suggestedName: String { preview?.name ?? "" }

  public var canStart: Bool {
    !starting && !isRunning && !url.trimmingCharacters(in: .whitespaces).isEmpty
      && preview != nil && preview?.problem == nil
  }

  /// Defaults, plus any clones already running (a reconnect, a second sheet).
  public func load() async {
    guard let backend = host.backend else { return }
    if defaults == nil, let loaded = try? await backend.request(Methods.ProjectsCloneDefaults.self, .init()) {
      defaults = loaded
      if parentDir.isEmpty { parentDir = loaded.parentDir }
    }
    await refreshClones()
    // Reopened while a clone runs: follow it rather than offer a second one.
    if cloneId == nil {
      cloneId = host.clones.values.filter { $0.status == .running }.max { $0.startedAt < $1.startedAt }?.id
    }
  }

  /// Re-reads the host's clones; events make it redundant once connected.
  public func refreshClones() async {
    guard let backend = host.backend,
      let listed = try? await backend.request(Methods.ProjectsClones.self, .init())
    else { return }
    for job in listed.clones { host.clones[job.id] = job }
  }

  /// Asks the host what these fields would clone into, or why they can't.
  public func refreshPreview() async {
    guard let backend = host.backend else { return }
    let trimmed = url.trimmingCharacters(in: .whitespaces)
    guard !trimmed.isEmpty else {
      preview = nil
      return
    }
    let input = ArgusProtocol.ClonePreviewInput(url: trimmed, parentDir: parentDir, name: name.nilIfBlank)
    if let next = try? await backend.request(Methods.ProjectsClonePreview.self, .init(input: input)) {
      preview = next
    }
  }

  /// Starts the clone; the job then follows from events.
  @discardableResult
  public func start(source: ArgusProtocol.CloneSource) async -> Bool {
    guard let backend = host.backend, canStart else { return false }
    starting = true
    defer { starting = false }
    let input = ArgusProtocol.StartCloneInput(
      url: url.trimmingCharacters(in: .whitespaces), parentDir: parentDir, name: name.nilIfBlank, source: source)
    do {
      let job = try await backend.request(Methods.ProjectsClone.self, .init(input: input)).clone
      // An event can land before the reply; keep whichever is further along.
      if host.clones[job.id] == nil { host.clones[job.id] = job }
      cloneId = job.id
      error = nil
      return true
    } catch {
      self.error = HostStore.describe(error)
      host.hooks.errorReported(error, "clone")
      return false
    }
  }

  public func cancel() async {
    guard let backend = host.backend, let cloneId, isRunning else { return }
    _ = try? await backend.request(Methods.ProjectsCloneCancel.self, .init(cloneId: cloneId))
  }

  /// Back to the form after a failure, keeping what was typed.
  public func retry() {
    cloneId = nil
    Task { await refreshPreview() }
  }

  /// Polls while running; covers a connection that missed an event.
  public func watch() async {
    while !Task.isCancelled, isRunning {
      try? await Task.sleep(for: .seconds(2))
      await refreshClones()
    }
  }

  public static func phaseLabel(_ phase: ArgusProtocol.ClonePhase) -> String {
    switch phase {
    case .connecting: "Connecting"
    case .counting: "Counting objects"
    case .compressing: "Compressing objects"
    case .receiving: "Receiving objects"
    case .resolving: "Resolving deltas"
    case .checkingOut: "Checking out files"
    default: phase.rawValue.capitalized
    }
  }

  /// Phase and percent in one line, e.g. "Receiving objects 42%".
  public static func progressLabel(_ job: Job) -> String {
    let phase = phaseLabel(job.phase)
    guard let percent = job.percent else { return phase }
    return "\(phase) \(Int(percent))%"
  }

  /// Overall progress across the phases, 0-1, for one bar instead of five.
  public static func overallFraction(_ job: Job) -> Double? {
    let weights: [(ArgusProtocol.ClonePhase, Double)] = [
      (.connecting, 0), (.counting, 0.05), (.compressing, 0.05), (.receiving, 0.7), (.resolving, 0.15),
      (.checkingOut, 0.05),
    ]
    guard let index = weights.firstIndex(where: { $0.0 == job.phase }) else { return nil }
    let done = weights[..<index].reduce(0) { $0 + $1.1 }
    let within = (job.percent ?? 0) / 100 * weights[index].1
    return min(1, done + within)
  }
}

extension String {
  fileprivate var nilIfBlank: String? {
    let trimmed = trimmingCharacters(in: .whitespaces)
    return trimmed.isEmpty ? nil : trimmed
  }
}
