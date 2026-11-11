import ArgusKit
import SwiftUI

/// Opens a runner's Install / Sign in. Nil where the app can't run it (the
/// phone), which leaves a missing runner disabled in its picker.
public struct RunnerSetupAction {
  private let run: @MainActor (RemoteRunner) -> Void

  public init(_ run: @escaping @MainActor (RemoteRunner) -> Void) { self.run = run }

  @MainActor public func callAsFunction(_ runner: RemoteRunner) { run(runner) }

  /// Whether a picker should offer to install `runner` rather than grey it out.
  public static func offers(_ runner: RemoteRunner) -> Bool {
    !runner.isAvailable && runner.setup?.canInstall == true
  }
}

extension EnvironmentValues {
  @Entry public var runnerSetup: RunnerSetupAction? = nil
}
