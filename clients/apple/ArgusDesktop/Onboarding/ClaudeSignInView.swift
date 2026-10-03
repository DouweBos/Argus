import ArgusCore
import ArgusUI
import SwiftUI

/// Signing in a Claude account during the first run. The CLI opens the
/// browser itself; when it can't, it asks for the code the page shows.
struct ClaudeSignInView: View {
  @Environment(HostStore.self) private var store
  @Environment(\.theme) private var theme
  @State private var console = false
  @State private var code = ""

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      if let accounts = store.claudeAccounts, !accounts.isEmpty {
        ForEach(accounts) { account in
          HStack(spacing: 8) {
            Image(systemName: account.needsReauth ? "exclamationmark.circle.fill" : "person.crop.circle.fill")
              .foregroundStyle(account.needsReauth ? theme.warning : theme.success)
            VStack(alignment: .leading, spacing: 1) {
              Text(account.displayName)
              if !account.subtitle.isEmpty {
                Text(account.subtitle).font(.caption).foregroundStyle(theme.textMuted)
              }
            }
            Spacer()
            if account.id == store.activeClaudeAccountId { Badge(label: "Active", tone: .success) }
          }
        }
      }
      if let login = store.claudeLogin, login.pending {
        pending(login)
      } else {
        HStack(spacing: 10) {
          Picker("Account type", selection: $console) {
            Text("Claude subscription").tag(false)
            Text("Anthropic Console").tag(true)
          }
          .labelsHidden()
          .fixedSize()
          Button(store.claudeAccounts?.isEmpty == false ? "Add another account" : "Sign in with Claude") {
            Task { await store.addClaudeAccount(useConsole: console) }
          }
          .buttonStyle(.borderedProminent)
        }
        if let login = store.claudeLogin, login.ok == false {
          Text(login.error ?? "Sign-in failed. Try again.").foregroundStyle(theme.error)
        }
      }
    }
    .task { await store.refreshClaudeAccounts() }
  }

  @ViewBuilder private func pending(_ login: RemoteClaudeLoginState) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        ProgressView().controlSize(.small)
        Text(
          login.needsCode
            ? "Paste the code the sign-in page shows."
            : "Finish signing in in your browser. This updates on its own."
        )
        .foregroundStyle(theme.textSecondary)
      }
      if login.needsCode {
        HStack {
          TextField("Code", text: $code).textFieldStyle(.roundedBorder).frame(maxWidth: 260)
          Button("Submit") {
            Task { await store.submitClaudeLoginCode(code) }
          }
          .disabled(code.trimmingCharacters(in: .whitespaces).isEmpty)
        }
      }
      Button("Cancel") { Task { await store.cancelClaudeLogin() } }
    }
  }
}
