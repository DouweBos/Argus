import AppKit
import ArgusCore
import Foundation
import Observation

/// The app: the supervised host, the backend to it, the shared store, and the
/// route. Views read it from the environment.
@MainActor
@Observable
final class DesktopModel {
  let supervisor: HostSupervisor
  let store: HostStore
  let platform = PlatformBridge()
  private(set) var backend: LocalBackend?

  private(set) var route: DesktopRoute = .home
  @ObservationIgnored private var back: [DesktopRoute] = []
  @ObservationIgnored private var forward: [DesktopRoute] = []

  init() {
    supervisor = HostSupervisor(configuration: HostLocation.configuration())
    store = HostStore(
      hooks: HostStoreHooks(errorReported: { error, scope in
        NSLog("[argus] %@: %@", scope, HostStore.describe(error))
      }))
    store.capabilities = ["monitor", "control", "admin"]
    supervisor.onEvent = { [weak self] event in self?.supervisorEvent(event) }
    platform.focusWindow = { NSApp.activate() }
  }

  func start() {
    MacTelemetry.capture(.launched)
    supervisor.start()
  }

  /// The host is up. The transport reconnects across host restarts on its
  /// own, so the backend is made once.
  private func hostRunning() async {
    guard backend == nil else { return }
    let platform = platform
    let backend = LocalBackend(socketPath: supervisor.configuration.socketPath) { envelope in
      Task { @MainActor in platform.handle(envelope) }
    }
    self.backend = backend
    store.beginConnecting()
    await store.attach(backend)
    platform.attach(backend)
    await MacTelemetry.attach(backend)
  }

  /// Refetch what the window shows; called whenever the connection comes up.
  func reload() async {
    await store.refreshProjects()
    await store.loadScratchPads()
    await store.loadRecentAgents()
    for project in store.projects {
      await store.loadSessions(repoRoot: project.repoRoot)
      await store.loadAgents(repoRoot: project.repoRoot)
    }
  }

  private func supervisorEvent(_ event: HostSupervisor.Event) {
    switch event {
    case .started(let restarts):
      MacTelemetry.capture(.hostStarted(restarts: restarts))
      Task { await hostRunning() }
    case .crashed(let exitCode, let attempt):
      MacTelemetry.capture(.hostCrashed(exitCode: Int(exitCode), attempt: attempt))
    case .gaveUp(let crashes):
      MacTelemetry.capture(.hostFailed(crashes: crashes))
    case .lockConflict(let holder):
      MacTelemetry.capture(.hostLockConflict(holder: .init(holder)))
    case .handover(let holder, let success):
      MacTelemetry.capture(.hostHandover(holder: .init(holder), success: success))
    }
  }

  // MARK: Navigation

  func navigate(_ next: DesktopRoute) {
    guard next != route else { return }
    back.append(route)
    forward = []
    route = next
    MacTelemetry.capture(.screenViewed(screen: next.pattern))
  }

  var canGoBack: Bool { !back.isEmpty }
  var canGoForward: Bool { !forward.isEmpty }

  func goBack() {
    guard let previous = back.popLast() else { return }
    forward.append(route)
    route = previous
  }

  func goForward() {
    guard let next = forward.popLast() else { return }
    back.append(route)
    route = next
  }

  // MARK: Quit

  var runningAgentCount: Int {
    store.statusByAgent.values.filter { $0.status == .running }.count
  }

  /// Stop the host cleanly: it lets agents finish stopping before it exits.
  func shutdown() async {
    MacTelemetry.capture(.quit(hadRunningAgents: runningAgentCount > 0))
    await store.detach()
    platform.detach()
    MacTelemetry.detach()
    await supervisor.stop()
  }
}

extension MacTelemetryEvent.Holder {
  init(_ owner: HostLockRecord.Owner) {
    switch owner {
    case .electron: self = .electron
    case .mac: self = .mac
    case .cli: self = .cli
    }
  }
}
