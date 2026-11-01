import ArgusUI
import SwiftUI

/// Every Claude account signed in on the computer, and which one new agents
/// run as. Each account gets its own Claude config directory, so choosing here
/// is what decides which subscription an agent burns.
struct ClaudeAccountsView: View {
  @Environment(HostStore.self) private var host
  @Environment(\.theme) private var theme

  @State private var renaming: RemoteClaudeAccount?
  @State private var useConsole = false
  /// Asked the computer to open a sign-in, not answered yet.
  @State private var startingLogin = false

  private var accounts: [RemoteClaudeAccount] { host.claudeAccounts ?? [] }

  var body: some View {
    List {
      // No inline error: the app-wide toast already shows `lastError`.
      if !accounts.isEmpty {
        Section("Accounts") {
          ForEach(accounts) { account in
            AccountRow(
              account: account,
              active: account.id == host.activeClaudeAccountId,
              canManage: host.hasControl
            ) {
              Task { await host.setActiveClaudeAccount(id: account.id) }
            } onLogin: {
              startLogin(accountId: account.id)
            } onRename: {
              renaming = account
            }
          }
        }
      }
      // Sign-in runs here in the list, as on the Mac, rather than in a sheet.
      if host.hasControl {
        ClaudeSignInSection(
          useConsole: $useConsole, starting: startingLogin, firstAccount: accounts.isEmpty
        ) { startLogin(accountId: nil) }
      }
    }
    .loadPhase(
      LoadPhase(
        loaded: host.claudeAccounts != nil, error: nil, isEmpty: accounts.isEmpty && !host.hasControl),
      loading: "Loading accounts…"
    ) {
      EmptyState(
        icon: Icon.person,
        title: "No Claude accounts",
        body: "Add one and agents can run on that subscription instead of "
          + "whichever account Claude was signed into first.")
    }
    .scrollContentBackground(.hidden)
    .navigationTitle("Claude Accounts")
    .navigationBarTitleDisplayMode(.inline)
    .task {
      await host.refreshClaudeAccounts()
      await host.loadClaudeLoginStatus()
    }
    .refreshable { await host.refreshClaudeAccounts() }
    .liveRefresh(enabled: host.connection == .ready) {
      await host.refreshClaudeAccounts()
      // The attempt runs on the computer, so follow what it reports.
      if host.claudeLogin?.pending == true { await host.loadClaudeLoginStatus() }
    }
    .onChange(of: host.claudeLogin?.pending) { _, pending in
      if pending == false { Task { await host.refreshClaudeAccounts() } }
    }
    .sheet(item: $renaming) { account in
      RenameSheet(account: account)
    }
  }

  /// A new account with no id, or signing an existing one in again.
  private func startLogin(accountId: String?) {
    startingLogin = true
    Task {
      if let accountId {
        _ = await host.startClaudeLogin(accountId: accountId, useConsole: useConsole)
      } else {
        _ = await host.addClaudeAccount(useConsole: useConsole)
      }
      startingLogin = false
      await host.refreshClaudeAccounts()
    }
  }
}

/// Add an account (or, with none yet, sign in), then follow the attempt the
/// computer runs. The browser can only open there, so a pasted code is the
/// phone's own way to finish.
private struct ClaudeSignInSection: View {
  @Environment(HostStore.self) private var host
  @Environment(\.theme) private var theme
  @Binding var useConsole: Bool
  let starting: Bool
  let firstAccount: Bool
  let start: () -> Void

  @State private var code = ""
  @State private var submitting = false
  @FocusState private var codeFocused: Bool

  private var login: RemoteClaudeLoginState? { host.claudeLogin }
  private var pending: Bool { login?.pending == true }
  private var trimmedCode: String { code.trimmingCharacters(in: .whitespacesAndNewlines) }

  var body: some View {
    Section {
      if starting {
        HStack(spacing: 8) {
          ProgressView()
          MutedText("Opening the browser on your computer…")
        }
      } else if pending {
        MutedText(
          login?.needsCode == true
            ? "Claude is waiting for the code the browser shows."
            : "Waiting for you to approve in the browser on your computer…")
        ThemedTextField(placeholder: "Paste the code", text: $code, input: .code, onSubmit: submit)
          .focused($codeFocused)
        HStack(spacing: 8) {
          Btn(label: "Cancel sign-in", tone: .secondary, small: true, hugs: true) {
            Task { await host.cancelClaudeLogin() }
          }
          .fixedSize()
          Spacer(minLength: 0)
          Btn(label: submitting ? "Signing in…" : "Sign in", small: true, icon: Icon.check, hugs: true, action: submit)
            .fixedSize()
            .disabled(trimmedCode.isEmpty || submitting)
        }
      } else {
        if let error = login?.error {
          Banner(text: error, tone: .danger)
        } else if login?.ok == true {
          Banner(text: "Signed in.", tone: .success)
        }
        Picker("Account type", selection: $useConsole) {
          Text("Claude subscription").tag(false)
          Text("Anthropic Console").tag(true)
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        Btn(label: firstAccount ? "Sign in" : "Add account", icon: Icon.plus, action: start)
      }
    } header: {
      Text(pending || starting ? "Complete sign-in" : firstAccount ? "Sign in" : "Add another account")
    } footer: {
      Text(caption)
    }
    .listRowSeparator(.hidden)
    .onChange(of: login?.needsCode) { _, needsCode in
      if needsCode == true { codeFocused = true }
    }
    .onChange(of: pending) { _, pending in
      if !pending { code = "" }
    }
  }

  private var caption: String {
    if pending {
      return "Finish on your computer, or paste the code the browser shows there."
    }
    return "A browser opens on your computer to approve access. Accounts already signed in stay signed in."
  }

  private func submit() {
    guard !trimmedCode.isEmpty, !submitting else { return }
    submitting = true
    Task {
      await host.submitClaudeLoginCode(trimmedCode)
      submitting = false
    }
  }
}

private struct AccountRow: View {
  let account: RemoteClaudeAccount
  let active: Bool
  let canManage: Bool
  let onSelect: () -> Void
  let onLogin: () -> Void
  let onRename: () -> Void

  @Environment(\.theme) private var theme
  @Environment(HostStore.self) private var host
  @State private var confirmingRemove = false

  var body: some View {
    Button(action: onSelect) {
      HStack(spacing: theme.space) {
        VStack(alignment: .leading, spacing: 4) {
          Text(account.displayName)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(theme.text)
          if !account.subtitle.isEmpty {
            Text(account.subtitle)
              .font(.footnote)
              .foregroundStyle(theme.textSecondary)
          }
          HStack(spacing: 6) {
            if account.needsReauth {
              Badge(label: "Signed out", tone: .danger)
            } else if account.rateLimited {
              Badge(label: "Limit reached", tone: .warning)
            }
            if account.accountType == .console {
              Badge(label: "Console", tone: .muted)
            }
          }
        }
        Spacer(minLength: theme.space)
        if active {
          Label("In use", systemImage: Icon.check)
            .font(.footnote.weight(.medium))
            .foregroundStyle(theme.success)
        }
      }
      .padding(.vertical, 4)
    }
    .buttonStyle(.plain)
    .contextMenu {
      if canManage {
        if account.needsReauth {
          Button("Sign in again", systemImage: Icon.web, action: onLogin)
        }
        Button("Rename", systemImage: Icon.pencil, action: onRename)
        Button("Remove", systemImage: Icon.trash, role: .destructive) {
          confirmingRemove = true
        }
      }
    }
    .confirmationDialog(
      "Remove \(account.displayName)?",
      isPresented: $confirmingRemove,
      titleVisibility: .visible
    ) {
      Button("Remove", role: .destructive) {
        Task { await host.removeClaudeAccount(id: account.id) }
      }
    } message: {
      Text("This clears the account from Argus; Claude's own credentials are untouched.")
    }
  }
}

private struct RenameSheet: View {
  let account: RemoteClaudeAccount

  @Environment(HostStore.self) private var host
  @Environment(\.dismiss) private var dismiss

  @State private var draft = ""

  var body: some View {
    NavigationStack {
      Screen {
        if let error = host.lastError {
          Banner(text: error, tone: .danger)
        }
        Field(label: "Name") {
          ThemedTextField(placeholder: account.email ?? account.id, text: $draft, input: .name)
        }
      }
      .navigationTitle("Rename")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Save") {
            Task {
              await host.renameClaudeAccount(id: account.id, label: draft)
              dismiss()
            }
          }
        }
      }
      .onAppear { draft = account.label ?? "" }
    }
  }
}
