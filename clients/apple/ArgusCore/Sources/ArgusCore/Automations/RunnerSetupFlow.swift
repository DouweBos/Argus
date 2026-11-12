import ArgusKit

/// One runner's walk from "not installed" to signed in: which step runs, how
/// it went, and what the setup sheet offers next.
public struct RunnerSetupFlow: Identifiable, Equatable, Sendable {
  public enum Step: String, Sendable { case install, login, logout }

  /// Where it started, so the host counts it once: the picker's, or the Accounts page's.
  public enum Source: String, Sendable { case picker, accounts }

  public enum Phase: Equatable, Sendable {
    case starting
    case running(terminalId: String)
    /// No install command: its page opened, and the user installs by hand.
    case openedPage(url: String)
    case finished(terminalId: String, exitCode: Int)
    case failed(String)
  }

  public enum Next: Equatable, Sendable { case wait, signIn, checkAgain, retry, done }

  public let runnerId: String
  public let displayName: String
  public let setup: RemoteRunner.Setup
  /// Whether the host last found its CLI.
  public var installed: Bool
  public var step: Step
  public var source: Source = .picker
  public var phase: Phase = .starting

  public var id: String { runnerId }

  public init(runnerId: String, displayName: String, setup: RemoteRunner.Setup, installed: Bool) {
    self.runnerId = runnerId
    self.displayName = displayName
    self.setup = setup
    self.installed = installed
    step = installed && setup.loginCommand != nil ? .login : .install
  }

  public init?(_ runner: RemoteRunner) {
    guard let setup = runner.setup, setup.canInstall || runner.isAvailable else { return nil }
    self.init(runnerId: runner.id, displayName: runner.displayName, setup: setup, installed: runner.isAvailable)
  }

  public init?(_ runner: ArgusProtocol.RegisteredRunner) {
    guard let setup = runner.setup else { return nil }
    let mapped = RemoteRunner.Setup(
      installCommand: setup.installCommand, installUrl: setup.installUrl, loginCommand: setup.loginCommand)
    guard mapped.canInstall || runner.isAvailable else { return nil }
    self.init(runnerId: runner.id, displayName: runner.displayName, setup: mapped, installed: runner.isAvailable)
  }

  /// One step of a runner on the Accounts page.
  public init(_ account: ArgusProtocol.RunnerAccount, step: Step) {
    let setup = RemoteRunner.Setup(
      installCommand: account.setup?.installCommand, installUrl: account.setup?.installUrl,
      loginCommand: account.setup?.loginCommand, logoutCommand: account.setup?.logoutCommand)
    self.init(runnerId: account.id, displayName: account.displayName, setup: setup, installed: account.isInstalled)
    self.step = step
    source = .accounts
  }

  /// What the current step runs in its terminal.
  public var command: String? {
    switch step {
    case .install: setup.installCommand
    case .login: setup.loginCommand
    case .logout: setup.logoutCommand
    }
  }

  public var terminalId: String? {
    switch phase {
    case .running(let id), .finished(let id, _): id
    default: nil
    }
  }

  public var next: Next {
    switch phase {
    case .starting, .running: return .wait
    case .failed: return .retry
    case .finished where step != .install: return .done
    case .finished(_, let code) where !installed: return code == 0 ? .checkAgain : .retry
    case .openedPage where !installed: return .checkAgain
    default: return setup.loginCommand != nil ? .signIn : .done
    }
  }
}
