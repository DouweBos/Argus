import ArgusCore
import ArgusKit
import Foundation
import Observation

/// First-run state: whether it shows, which step it's on, and the actions the
/// steps share. The window shows onboarding until the host says it's complete,
/// as the desktop decides.
@MainActor
@Observable
final class OnboardingModel {
  private(set) var loaded = false
  private(set) var visible = false
  private(set) var step = OnboardingStepId.welcome
  private(set) var recentProjects: [String] = []
  private(set) var examples: [ArgusProtocol.ExampleProject]?
  private(set) var cloning: String?
  var error: String?
  /// The project the last step added, reviewed before onboarding closes.
  var addedProject: String?
  /// Projects found in Claude Code CLI history, kept across Back and forth.
  let cliProjects = CliProjectPicker(source: .onboarding)

  private static let localStepKey = "onboardingStep"

  func load(_ backend: HostRouter) async {
    guard let state = try? await backend.request(ArgusProtocol.Commands.OnboardingGetState.self, .init())
    else { return }
    recentProjects = state.recentProjects
    visible = !state.onboarding.completed
    step = OnboardingStepId.resume(
      hostStep: state.onboarding.lastStep, local: HomeDefaults.shared.string(forKey: Self.localStepKey))
    loaded = true
  }

  func go(to next: OnboardingStepId, _ backend: HostRouter) async {
    step = next
    HomeDefaults.shared.set(next.rawValue, forKey: Self.localStepKey)
    _ = try? await backend.request(ArgusProtocol.Commands.OnboardingSetLastStep.self, .init(step: next.hostStep))
  }

  /// Leaves a step without doing it; the host keeps the list.
  func skip(_ backend: HostRouter) async {
    MacTelemetry.capture(.onboardingStep(step: step.rawValue, skipped: true))
    _ = try? await backend.request(ArgusProtocol.Commands.OnboardingAddSkipped.self, .init(id: step.rawValue))
    await advance(backend)
  }

  func advance(_ backend: HostRouter) async {
    if let next = step.next {
      await go(to: next, backend)
    } else {
      await complete(backend)
    }
  }

  func complete(_ backend: HostRouter) async {
    _ = try? await backend.request(ArgusProtocol.Commands.OnboardingComplete.self, .init())
    HomeDefaults.shared.removeObject(forKey: Self.localStepKey)
    visible = false
  }

  /// The privacy choice: kept by this app, applied to the host.
  func chooseTelemetry(_ mode: String, _ backend: HostRouter) async {
    MacTelemetry.mode = mode
    _ = try? await backend.request(
      ArgusProtocol.Commands.TelemetrySetMode.self, .init(mode: ArgusProtocol.TelemetryMode(rawValue: mode)))
    MacTelemetry.capture(.onboardingStep(step: OnboardingStepId.privacy.rawValue, skipped: false))
    await advance(backend)
  }

  func loadExamples(_ backend: HostRouter) async {
    guard examples == nil else { return }
    examples = (try? await backend.request(ArgusProtocol.Commands.OnboardingListExamples.self, .init())) ?? []
  }

  /// Clones into the Argus home and adds it like any other project.
  func clone(_ example: ArgusProtocol.ExampleProject, _ backend: HostRouter) async {
    cloning = example.slug
    error = nil
    defer { cloning = nil }
    do {
      let result = try await backend.request(
        ArgusProtocol.Commands.OnboardingCloneExample.self, .init(slug: example.slug))
      try await ProjectRegistration.add(result.path, source: .example, backend)
      addedProject = result.path
    } catch {
      self.error = HostStore.describe(error)
    }
  }

  func add(_ path: String, source: MacTelemetryEvent.ProjectSource, _ backend: HostRouter) async {
    error = nil
    do {
      try await ProjectRegistration.add(path, source: source, backend)
      addedProject = path
    } catch {
      self.error = HostStore.describe(error)
    }
  }
}

/// Adding a project the way the desktop's open-repo flow does: register the
/// root with the host (which persists it and tells every window) and put it on
/// the recent list. The host's `projects.changed` opens it in the sidebar.
@MainActor
enum ProjectRegistration {
  static func add(_ path: String, source: MacTelemetryEvent.ProjectSource, _ backend: HostRouter) async throws {
    try await backend.request(ArgusProtocol.Commands.AddRepoRoot.self, .init(path: path))
    _ = try? await backend.request(ArgusProtocol.Commands.OnboardingRegisterProject.self, .init(path: path))
    MacTelemetry.capture(.projectAdded(source: source))
  }
}
