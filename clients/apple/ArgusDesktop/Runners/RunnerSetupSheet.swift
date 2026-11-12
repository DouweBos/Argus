import ArgusCore
import ArgusUI
import SwiftUI

/// Install a runner's CLI, then sign in to it: each step's command runs in the
/// terminal below, where its prompts can be answered.
struct RunnerSetupSheet: View {
  let setup: RunnerSetupModel
  @Environment(\.theme) private var theme
  @State private var search = TerminalSearchState()

  var body: some View {
    if let flow = setup.flow {
      VStack(spacing: 0) {
        header(flow)
        Divider()
        content(flow).frame(maxWidth: .infinity, maxHeight: .infinity)
        Divider()
        footer(flow)
      }
      .frame(width: 640, height: 480)
    }
  }

  private func header(_ flow: RunnerSetupFlow) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      if flow.step == .logout {
        Text("Sign Out of \(flow.displayName)").font(.scaled(.headline))
        stepLabel(1, "Sign out", command: flow.setup.logoutCommand, state: loginState(flow))
      } else {
        Text("Set Up \(flow.displayName)").font(.scaled(.headline))
        HStack(spacing: 16) {
          stepLabel(1, "Install", command: flow.setup.installCommand ?? flow.setup.installUrl, state: installState(flow))
          if let login = flow.setup.loginCommand {
            stepLabel(2, "Sign in", command: login, state: loginState(flow))
          }
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(16)
  }

  private enum StepState { case pending, active, done }

  private func installState(_ flow: RunnerSetupFlow) -> StepState {
    flow.installed ? .done : .active
  }

  private func loginState(_ flow: RunnerSetupFlow) -> StepState {
    guard flow.step != .install else { return .pending }
    if case .finished(_, 0) = flow.phase { return .done }
    return .active
  }

  private func stepLabel(_ number: Int, _ title: String, command: String?, state: StepState) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 6) {
      Group {
        switch state {
        case .done: Image(systemName: "checkmark.circle.fill").foregroundStyle(theme.success)
        case .active: Image(systemName: "\(number).circle.fill").foregroundStyle(theme.accent)
        case .pending: Image(systemName: "\(number).circle").foregroundStyle(theme.textMuted)
        }
      }
      VStack(alignment: .leading, spacing: 2) {
        Text(title).font(.scaled(size: 13, weight: .semibold))
        if let command {
          Text(command)
            .font(.scaled(size: 11, design: .monospaced))
            .foregroundStyle(theme.textSecondary)
            .lineLimit(1).truncationMode(.middle)
            .textSelection(.enabled)
        }
      }
    }
  }

  @ViewBuilder private func content(_ flow: RunnerSetupFlow) -> some View {
    switch flow.phase {
    case .starting:
      ProgressView().controlSize(.small)
    case .running(let terminalId), .finished(let terminalId, _):
      TerminalSurface(terminalId: terminalId, isActive: true, search: search, onNewTab: {}, onClose: {})
        .id(terminalId)
        .padding(8)
    case .openedPage(let url):
      message(
        "Install \(flow.displayName) from the page that just opened",
        detail: "\(url)\nCome back once it's installed and check again.")
    case .failed(let error):
      message("Couldn't start", detail: error, tone: theme.error)
    }
  }

  private func message(_ title: String, detail: String, tone: Color? = nil) -> some View {
    VStack(spacing: 6) {
      Text(title).font(.scaled(size: 13, weight: .semibold)).foregroundStyle(tone ?? theme.text)
      Text(detail).font(.scaled(.caption)).foregroundStyle(theme.textSecondary)
        .multilineTextAlignment(.center).textSelection(.enabled)
    }
    .padding(24)
  }

  private func footer(_ flow: RunnerSetupFlow) -> some View {
    HStack {
      Text(status(flow)).font(.scaled(.caption)).foregroundStyle(theme.textSecondary)
      Spacer()
      Button(flow.next == .done ? "Done" : "Close") { setup.close() }
        .keyboardShortcut(flow.next == .done ? .defaultAction : .cancelAction)
      switch flow.next {
      case .signIn:
        Button("Sign In") { setup.signIn() }
          .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
      case .checkAgain:
        Button("Check Again") { setup.checkAgain() }
          .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
      case .retry:
        Button("Try Again") { setup.retry() }
          .buttonStyle(.borderedProminent).keyboardShortcut(.defaultAction)
      case .wait, .done:
        EmptyView()
      }
    }
    .padding(16)
  }

  private func status(_ flow: RunnerSetupFlow) -> String {
    switch (flow.phase, flow.next) {
    case (.running, _) where flow.step == .logout: "Signing out… answer any prompts in the terminal."
    case (.running, _): flow.step == .install ? "Installing…" : "Signing in… answer any prompts in the terminal."
    case (.finished(_, 0), .done) where flow.step == .logout: "Signed out of \(flow.displayName)."
    case (.finished, _) where flow.step == .logout: "That didn't finish cleanly. Read the output above."
    case (_, .signIn): "\(flow.displayName) is installed. Sign in to start agents on it."
    case (.openedPage, .checkAgain): "Not found yet. Check again once it's installed."
    case (_, .checkAgain): "Installed, but not found on your PATH yet. Check again."
    case (.finished, .done): "\(flow.displayName) is set up. Pick it in any runner picker."
    case (_, .done): "\(flow.displayName) is installed."
    case (.finished, .retry): "That didn't finish cleanly. Read the output above, then try again."
    default: ""
    }
  }
}

/// Presents the runner setup sheet over the window it was started from.
struct RunnerSetupPresenter: ViewModifier {
  let window: RunnerSetupModel.Window
  @Environment(DesktopModel.self) private var model

  func body(content: Content) -> some View {
    let setup = model.runnerSetup
    content
      .sheet(
        isPresented: Binding(
          get: { setup.flow != nil && setup.window == window },
          set: { if !$0 { setup.close() } })
      ) {
        RunnerSetupSheet(setup: setup).environment(model.terminals).themed()
      }
      .environment(\.runnerSetup, RunnerSetupAction { [weak setup] in setup?.begin($0, in: window) })
  }
}
