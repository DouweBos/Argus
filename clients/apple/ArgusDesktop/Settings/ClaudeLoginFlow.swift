import ArgusCore
import Observation
import SwiftUI

/// Signing a Claude account in, or back in. The CLI opens the browser itself
/// and finishes over a loopback callback; a pasted code is the fallback when
/// it can't.
@MainActor
@Observable
final class ClaudeLoginFlow {
  enum Phase { case idle, starting, awaitingBrowser, awaitingCode, submitting }

  private(set) var phase = Phase.idle
  /// Kept for "Reopen sign-in page" rather than opening a second tab.
  private(set) var url: String?
  var useConsole = false
  var code = ""
  var error: String?
  @ObservationIgnored private weak var host: HostSettingsModel?

  /// A new account when `accountId` is nil, else that account in place.
  func start(accountId: String?, host: HostSettingsModel, refresh: @escaping () async -> Void) {
    self.host = host
    error = nil
    phase = .starting
    Task {
      let result: ArgusProtocol.ClaudeLoginUrl?
      if let accountId {
        result = await host.run(
          ArgusProtocol.Commands.ClaudeAuthLoginStart.self,
          .init(useConsole: useConsole, accountId: accountId))
      } else {
        result = await host.run(ArgusProtocol.Commands.ClaudeAccountsAdd.self, .init(useConsole: useConsole))
      }
      if let result {
        url = result.url
        phase = .awaitingBrowser
        MacTelemetry.capture(.settingsChanged(setting: accountId == nil ? .accountAdded : .accountReauth))
      } else {
        error = host.error
        host.error = nil
        reset()
      }
      await refresh()
    }
  }

  func reopen() {
    guard let url, let host else { return }
    Task { await host.run(ArgusProtocol.Commands.OpenExternalUrl.self, .init(url: url)) }
  }

  func submit(refresh: @escaping () async -> Void) {
    guard let host, !code.trimmingCharacters(in: .whitespaces).isEmpty else { return }
    error = nil
    phase = .submitting
    Task {
      let result = await host.run(ArgusProtocol.Commands.ClaudeAuthLoginSubmitCode.self, .init(code: code))
      if result?.ok == true {
        reset()
        await refresh()
      } else {
        error = result?.error ?? host.error ?? "Login failed."
        phase = .awaitingCode
      }
    }
  }

  func cancel(refresh: @escaping () async -> Void) {
    guard let host else { return reset() }
    error = nil
    reset()
    Task {
      await host.run(ArgusProtocol.Commands.ClaudeAuthLoginCancel.self, EmptyParams())
      await refresh()
    }
  }

  /// The host reports the outcome, or that the CLI wants a pasted code.
  func handle(channel: String, args: [JSONValue]) {
    switch channel {
    case "claude-auth:login-result":
      if case .object(let payload)? = args.first, payload["ok"] != .bool(true) {
        if case .string(let message)? = payload["error"] { error = message } else { error = "Login failed." }
      }
      reset()
    case "claude-auth:login-needs-code":
      if phase == .awaitingBrowser { phase = .awaitingCode }
    default:
      break
    }
  }

  private func reset() {
    phase = .idle
    url = nil
    code = ""
  }
}

/// Add an account (or, with none yet, sign in), then follow the attempt.
struct ClaudeLoginSection: View {
  @Environment(HostSettingsModel.self) private var host
  @Bindable var login: ClaudeLoginFlow
  let firstAccount: Bool
  let refresh: () async -> Void

  var body: some View {
    Section {
      switch login.phase {
      case .idle:
        Picker("Account type", selection: $login.useConsole) {
          Text("Claude subscription").tag(false)
          Text("Anthropic Console").tag(true)
        }
        .pickerStyle(.segmented)
        Button(firstAccount ? "Log In" : "Add Account") {
          login.start(accountId: nil, host: host, refresh: refresh)
        }
        .buttonStyle(.borderedProminent)
      case .starting:
        HStack {
          ProgressView().controlSize(.small)
          Text("Opening browser…").foregroundStyle(.secondary)
        }
      case .awaitingBrowser:
        Text("Waiting for you to approve in your browser…").foregroundStyle(.secondary)
        HStack {
          if login.url != nil { Button("Reopen Sign-in Page") { login.reopen() } }
          Spacer()
          Button("Cancel") { login.cancel(refresh: refresh) }
        }
      case .awaitingCode, .submitting:
        TextField("Authorization code", text: $login.code, prompt: Text("Paste authorization code"))
          .onSubmit { login.submit(refresh: refresh) }
        HStack {
          if login.url != nil { Button("Reopen Sign-in Page") { login.reopen() } }
          Spacer()
          Button("Cancel") { login.cancel(refresh: refresh) }
          Button(login.phase == .submitting ? "Signing in…" : "Sign In") { login.submit(refresh: refresh) }
            .buttonStyle(.borderedProminent)
            .disabled(login.code.trimmingCharacters(in: .whitespaces).isEmpty || login.phase == .submitting)
        }
      }
    } header: {
      Text(login.phase == .idle ? (firstAccount ? "Sign in" : "Add another account") : "Complete sign-in")
    } footer: {
      SettingsCaption(caption)
    }
  }

  private var caption: String {
    switch login.phase {
    case .awaitingCode, .submitting:
      "Approve access in the browser, then paste the code shown there."
    case .starting, .awaitingBrowser:
      "A browser window should have opened. Approve access and this will finish on its own."
    case .idle:
      "Opens your browser to authenticate — approve access there and Argus signs in automatically. "
        + "Accounts already signed in stay signed in."
    }
  }
}
