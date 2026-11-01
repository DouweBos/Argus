import ArgusUI
import SwiftUI

/// Every Claude account signed in on the computer, and which one new agents
/// run as. Each account gets its own Claude config directory, so choosing here
/// is what decides which subscription an agent burns.
struct ClaudeAccountsView: View {
  @Environment(HostStore.self) private var host
  @Environment(\.theme) private var theme

  @State private var adding = false
  @State private var loggingIn: LoginTarget?
  @State private var renaming: RemoteClaudeAccount?

  var body: some View {
    List {
      // No inline error: the app-wide toast already shows `lastError`.
      if let login = host.claudeLogin, login.pending {
        // A sign-in is always about some row; the banner is the way back to it.
        Button {
          loggingIn = LoginTarget(id: host.activeClaudeAccountId)
        } label: {
          Banner(text: pendingLoginText(login), tone: .accent)
        }
        .buttonStyle(.plain)
        .listRowSeparator(.hidden)
      }

      if host.claudeAccounts?.isEmpty == false {
        Section("Accounts") {
          ForEach(host.claudeAccounts ?? []) { account in
            AccountRow(
              account: account,
              active: account.id == host.activeClaudeAccountId,
              canManage: host.hasControl
            ) {
              Task { await host.setActiveClaudeAccount(id: account.id) }
            } onLogin: {
              loggingIn = LoginTarget(id: account.id)
            } onRename: {
              renaming = account
            }
          }
        }
      }
    }
    .loadPhase(
      LoadPhase(
        loaded: host.claudeAccounts != nil, error: nil, isEmpty: host.claudeAccounts?.isEmpty ?? true),
      loading: "Loading accounts…"
    ) {
      EmptyState(
        icon: Icon.person,
        title: "No Claude accounts",
        body: "Add one and agents can run on that subscription instead of "
          + "whichever account Claude was signed into first.")
    }
    .scrollContentBackground(.hidden)
    .safeAreaInset(edge: .bottom, spacing: 0) {
      if host.hasControl {
        Btn(label: "Add account", icon: Icon.plus) { adding = true }
          .padding(theme.space)
          .background(theme.bg)
      }
    }
    .navigationTitle("Claude Accounts")
    .navigationBarTitleDisplayMode(.inline)
    .task {
      await host.refreshClaudeAccounts()
      await host.loadClaudeLoginStatus()
    }
    .refreshable { await host.refreshClaudeAccounts() }
    .liveRefresh(enabled: host.connection == .ready) { await host.refreshClaudeAccounts() }
    .sheet(isPresented: $adding) { AddAccountSheet() }
    .sheet(item: $loggingIn) { target in
      ClaudeLoginSheet(accountId: target.id)
    }
    .sheet(item: $renaming) { account in
      RenameSheet(account: account)
    }
  }

  /// A dead token and a spent quota want different fixes, and only one of them
  /// is signing in again — the banner says which the phone can actually do.
  private func pendingLoginText(_ login: RemoteClaudeLoginState) -> String {
    login.needsCode
      ? "Claude on your computer is waiting for a code — tap to paste it."
      : "Sign-in open on your computer — tap to follow along."
  }
}

/// Which row a sign-in belongs to. `sheet(item:)` needs Identifiable, and an
/// id-only payload keeps the sheet from holding a stale copy of the account.
struct LoginTarget: Identifiable {
  let id: String?
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

/// Follows a sign-in that runs on the computer. The browser can only open
/// there, so the phone's only path to finishing is the code the CLI prints
/// when the browser flow isn't available.
private struct ClaudeLoginSheet: View {
  @Environment(HostStore.self) private var host
  @Environment(\.dismiss) private var dismiss

  let accountId: String?

  @State private var code = ""
  @State private var working = false
  @FocusState private var codeFocused: Bool

  private var state: RemoteClaudeLoginState? { host.claudeLogin }

  var body: some View {
    NavigationStack {
      Screen {
        if let error = host.lastError {
          Banner(text: error, tone: .danger)
        }
        if state?.ok == true {
          Banner(text: "Signed in.", tone: .success)
        } else if let error = state?.error {
          Banner(text: error, tone: .danger)
        }

        if state?.pending == true {
          Banner(
            text: "Claude is signing in on your computer. Finish it there, or paste "
              + "the code it shows below.",
            tone: .accent
          )
          Field(label: "Paste the code") {
            ThemedTextField(placeholder: "Code from your computer", text: $code, input: .code)
              .focused($codeFocused)
          }
          Btn(label: "Submit code", icon: Icon.check, action: submit)
            .disabled(code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || working)
          Btn(label: "Cancel sign-in", tone: .danger) {
            Task {
              await host.cancelClaudeLogin()
              dismiss()
            }
          }
        } else {
          Banner(
            text: "A browser opens on your computer to authorise Claude. It can't "
              + "complete there from here — the code below is the phone's way in.",
            tone: .accent
          )
          Btn(label: "Sign in on your computer", icon: Icon.web, action: start)
            .disabled(working)
        }
      }
      .navigationTitle("Sign In")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Done") { dismiss() }
        }
      }
      .onAppear {
        if state?.pending != true {
          Task { await host.loadClaudeLoginStatus() }
        }
      }
      // The attempt runs on the computer, so react to what the host reports.
      .onChange(of: state?.needsCode) { _, needsCode in
        if needsCode == true { codeFocused = true }
      }
      .onChange(of: state?.pending) { _, pending in
        if pending == false { Task { await host.refreshClaudeAccounts() } }
      }
    }
  }

  private func start() {
    working = true
    Task {
      await host.startClaudeLogin(accountId: accountId)
      working = false
      if host.claudeLogin?.needsCode == true { codeFocused = true }
    }
  }

  private func submit() {
    working = true
    Task {
      await host.submitClaudeLoginCode(code)
      working = false
      code = ""
    }
  }
}

private struct AddAccountSheet: View {
  @Environment(HostStore.self) private var host
  @Environment(\.dismiss) private var dismiss

  @State private var useConsole = false

  var body: some View {
    NavigationStack {
      Screen {
        if let error = host.lastError {
          Banner(text: error, tone: .danger)
        }
        Field(
          label: "SUBSCRIPTION",
          caption: "Which kind of Claude plan the new account is on."
        ) {
          Picker("Subscription", selection: $useConsole) {
            Text("Claude subscription").tag(false)
            Text("Anthropic Console").tag(true)
          }
          .pickerStyle(.segmented)
          .labelsHidden()
        }
        Btn(label: "Add and sign in", icon: Icon.plus, action: add)
      }
      .navigationTitle("Add Account")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
      }
    }
  }

  /// The browser opens on the computer and the account it lands on isn't known
  /// until the refresh arrives, so the sheet has nothing to wait for — close it
  /// and let the list fill in.
  private func add() {
    Task {
      await host.addClaudeAccount(useConsole: useConsole)
      dismiss()
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
