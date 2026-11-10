import ArgusUI
import Foundation
import LocalAuthentication
import Observation

/// The share extension's state: the shared items, the computers the app
/// mirrored, and a connection of its own to the one picked.
@MainActor
@Observable
final class ShareModel {
  enum Phase {
    case loading, locked, unpaired, ready
  }

  private(set) var phase: Phase = .loading
  private(set) var items = SharedItems()
  private(set) var snapshot: ShareSnapshot?
  private(set) var hostId: String?
  var path: [ShareDestination] = []
  let host = HostStore()

  @ObservationIgnored private let providers: [NSItemProvider]
  @ObservationIgnored private let onDone: (Bool) -> Void
  @ObservationIgnored private var generation = 0
  @ObservationIgnored private var finished = false

  init(providers: [NSItemProvider], onDone: @escaping (Bool) -> Void) {
    self.providers = providers
    self.onDone = onDone
  }

  var hosts: [DeviceIdentity] { snapshot?.hosts ?? [] }
  var identity: DeviceIdentity? { hosts.first { $0.deviceId == hostId } }
  var defaultMode: RemotePermissionMode? { snapshot?.defaultPermissionMode.flatMap(RemotePermissionMode.init(rawValue:)) }

  func begin() async {
    items = await SharedItems.load(providers)
    await unlock()
  }

  /// The app's own gate: biometrics when enrolled, nothing to get past otherwise.
  func unlock() async {
    let context = LAContext()
    if context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil) {
      let ok = (try? await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: "Unlock Argus"))
        ?? false
      guard ok else {
        phase = .locked
        return
      }
    }
    snapshot = await ShareHandoff().loadSnapshot()
    guard let snapshot, !snapshot.hosts.isEmpty else {
      phase = .unpaired
      return
    }
    hostId = snapshot.hosts.contains { $0.deviceId == snapshot.activeId } ? snapshot.activeId : snapshot.hosts.first?.deviceId
    phase = .ready
    await connect()
  }

  func select(hostId id: String) async {
    guard id != hostId else { return }
    hostId = id
    path = []
    await connect()
  }

  func connect() async {
    guard let identity else { return }
    generation += 1
    let current = generation
    await host.detach()
    host.reset()
    host.capabilities = identity.capabilities
    host.beginConnecting()
    do {
      let attempt = try await EndpointRacer.connectBest(identity: identity)
      guard current == generation else { return await attempt.transport.disconnect() }
      let backend = GatewayBackend(transport: attempt.transport)
      await host.attach(backend)
      struct CapabilitiesResult: Decodable { let capabilities: [String] }
      if let result = try? await backend.request(.deviceCapabilities, EmptyParams(), as: CapabilitiesResult.self) {
        host.capabilities = result.capabilities
      }
      await host.refreshProjects()
      await host.loadRecentAgents()
    } catch {
      guard current == generation else { return }
      host.connectFailed("Couldn't reach \(identity.label) on any known address.")
    }
  }

  /// Seeds the composer with what was shared, then opens it.
  func compose(repoRoot: String, sessionId: String?) {
    AgentStartPane.seedDraft(
      text: items.draft, images: items.images.map(\.attachment), repoRoot: repoRoot,
      sessionId: sessionId ?? rootSessionId(repoRoot))
    path.append(.compose(repoRoot: repoRoot, sessionId: sessionId))
  }

  /// A new worktree starts from the project's root session, as the app's New Session does.
  func rootSessionId(_ repoRoot: String) -> String? {
    host.sessionsByRepo[repoRoot]?.first { $0.kind == .projectRoot }?.id
  }

  func started(workspace: StartWorkspace.Kind) {
    finish(.started, workspace: workspace.rawValue)
  }

  func cancel() {
    let reachable = host.connection == .ready
    finish(phase == .unpaired ? .unpaired : reachable || phase != .ready ? .cancelled : .unreachable, workspace: nil)
  }

  private func finish(_ result: ShareHandoff.Outcome.Result, workspace: String?) {
    guard !finished else { return }
    finished = true
    ShareHandoff().record(
      .init(
        result: result, hasImages: !items.images.isEmpty, hasLink: items.hasLink, hasText: items.hasText,
        workspace: workspace))
    let started = result == .started
    Task {
      await host.detach()
      onDone(started)
    }
  }
}
