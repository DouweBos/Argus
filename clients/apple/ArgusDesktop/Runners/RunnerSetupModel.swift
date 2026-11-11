import ArgusCore
import ArgusKit
import Foundation
import Observation

/// Installing a runner's CLI and signing in to it from its picker entry: the
/// one flow the setup sheet shows, and the runner lists it refreshes after.
@MainActor
@Observable
final class RunnerSetupModel {
  /// Which window the sheet opens over: the one the user clicked in.
  enum Window { case main, settings, projectSettings }

  var flow: RunnerSetupFlow?
  private(set) var window: Window = .main
  /// Bumped when the host re-probed a runner, for lists this model doesn't own.
  private(set) var revision = 0
  @ObservationIgnored private weak var model: DesktopModel?

  /// Wires the model to the app's host; called once from `DesktopModel.init`.
  func install(on model: DesktopModel) {
    self.model = model
    _ = model.store.observeIpc { [weak self] channel, args, _ in
      guard channel == "llm:runners_changed" else { return }
      self?.runnersChanged(args.first ?? .null)
    }
  }

  func begin(_ runner: RemoteRunner, in window: Window = .main) {
    guard let flow = RunnerSetupFlow(runner) else { return }
    begin(flow, in: window)
  }

  func begin(_ flow: RunnerSetupFlow, in window: Window) {
    self.flow = flow
    self.window = window
    Task { await run() }
  }

  func signIn() {
    flow?.step = .login
    Task { await run() }
  }

  func retry() { Task { await run() } }

  func checkAgain() { Task { await reload() } }

  func close() { flow = nil }

  private func run() async {
    guard var current = flow, let backend = model?.backend else { return }
    current.phase = .starting
    flow = current
    let phase: RunnerSetupFlow.Phase
    do {
      let started = try await backend.request(
        ArgusProtocol.Commands.LlmRunnerSetup.self,
        .init(runnerId: current.runnerId, step: .init(rawValue: current.step.rawValue)))
      if let terminalId = started.terminalId {
        phase = .running(terminalId: terminalId)
      } else {
        phase = .openedPage(url: started.openedUrl ?? "")
      }
    } catch {
      phase = .failed(HostStore.describe(error))
    }
    guard flow?.runnerId == current.runnerId else { return }
    flow?.phase = phase
  }

  private func runnersChanged(_ payload: JSONValue) {
    struct Changed: Decodable {
      let runnerId: String
      let exitCode: Int?
    }
    if let changed = try? ProtocolCodec.convert(payload, to: Changed.self),
      let flow, flow.runnerId == changed.runnerId, case .running(let terminalId) = flow.phase
    {
      self.flow?.phase = .finished(terminalId: terminalId, exitCode: changed.exitCode ?? -1)
    }
    Task { await reload() }
  }

  private func reload() async {
    guard let model else { return }
    await model.store.reloadRunners()
    await model.automations.loadRunners()
    revision += 1
    if let id = flow?.runnerId, let runner = model.store.runners.first(where: { $0.id == id }) {
      flow?.installed = runner.isAvailable
    }
  }
}
