import ArgusCore
import ArgusUI
import SwiftUI

/// Add an account (or, with none yet, sign in), then follow the attempt in
/// `HostStore.claudeLogin`. The CLI opens the browser itself and finishes over a
/// loopback callback; a pasted code is the fallback when it can't.
struct ClaudeLoginSection: View {
  @Environment(HostStore.self) private var store
  @Environment(HostSettingsModel.self) private var host
  @Binding var useConsole: Bool
  let starting: Bool
  let firstAccount: Bool
  let start: () -> Void
  @State private var code = ""
  @State private var submitting = false

  private var login: RemoteClaudeLoginState? { store.claudeLogin }
  private var pending: Bool { login?.pending == true }

  var body: some View {
    SettingsGroup(
      pending || starting ? "Complete sign-in" : (firstAccount ? "Sign in" : "Add another account"),
      footer: caption
    ) {
      if starting {
        HStack {
          ProgressView().controlSize(.small)
          Text("Opening browser…").foregroundStyle(.secondary)
        }
      } else if let login, login.pending {
        VStack(alignment: .leading, spacing: 8) {
          if login.needsCode {
            TextField("Authorization code", text: $code, prompt: Text("Paste authorization code"))
              .labelsHidden()
              .textFieldStyle(.roundedBorder)
              .onSubmit(submit)
          } else {
            Text("Waiting for you to approve in your browser…").foregroundStyle(.secondary)
          }
          HStack {
            if store.claudeLoginURL != nil { Button("Reopen Sign-in Page", action: reopen) }
            Spacer()
            Button("Cancel") { Task { await store.cancelClaudeLogin() } }
            if login.needsCode {
              Button(submitting ? "Signing in…" : "Sign In", action: submit)
                .buttonStyle(.borderedProminent)
                .disabled(code.trimmingCharacters(in: .whitespaces).isEmpty || submitting)
            }
          }
        }
      } else {
        SettingsRow("Account type") {
          Picker("Account type", selection: $useConsole) {
            Text("Claude subscription").tag(false)
            Text("Anthropic Console").tag(true)
          }
          .pickerStyle(.segmented)
        }
        HStack {
          Spacer()
          Button(firstAccount ? "Log In" : "Add Account", action: start)
            .buttonStyle(.borderedProminent)
        }
      }
    }
    .onChange(of: pending) { _, pending in if !pending { code = "" } }
  }

  /// Opened by the host, so a remote host's sign-in lands in its own browser.
  private func reopen() {
    guard let url = store.claudeLoginURL else { return }
    Task { await host.run(ArgusProtocol.Commands.OpenExternalUrl.self, .init(url: url)) }
  }

  private func submit() {
    guard !code.trimmingCharacters(in: .whitespaces).isEmpty, !submitting else { return }
    submitting = true
    Task {
      await store.submitClaudeLoginCode(code)
      submitting = false
    }
  }

  private var caption: String {
    if login?.needsCode == true, pending {
      return "Approve access in the browser, then paste the code shown there."
    }
    if pending || starting {
      return "A browser window should have opened. Approve access and this will finish on its own."
    }
    return "Opens your browser to authenticate — approve access there and Argus signs in automatically. "
      + "Accounts already signed in stay signed in."
  }
}
