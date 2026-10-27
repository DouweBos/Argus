import ArgusCore
import ArgusUI
import SwiftUI

/// Every Claude account signed in on this machine and which one new agents
/// run as; switching never interrupts a running agent.
struct AccountsSettingsTab: View {
  @Environment(HostStore.self) private var store
  @Environment(HostSettingsModel.self) private var host
  @State private var login = ClaudeLoginFlow()
  @State private var renaming: RemoteClaudeAccount?
  @State private var removing: RemoteClaudeAccount?
  @State private var unobserve: (() -> Void)?

  private var accounts: [RemoteClaudeAccount] { store.claudeAccounts ?? [] }

  var body: some View {
    SettingsPage {
      SettingsGroup(
        "Accounts",
        footer: accounts.isEmpty
          ? nil
          : "Agents and terminals use the selected account. Sessions pinned to another account keep "
            + "theirs, and running agents are never interrupted by a switch. An account marked Signed "
            + "out has expired credentials — sign in again to renew them. Limit reached means the "
            + "plan's quota is spent: nothing to fix, it clears on its own."
      ) {
        if store.claudeAccounts == nil {
          SettingsLoading()
        } else if accounts.isEmpty {
          Text("No accounts signed in yet.").foregroundStyle(.secondary)
        }
        ForEach(accounts) { account in
          AccountRow(account: account, active: account.id == store.activeClaudeAccountId) {
            Task {
              await store.setActiveClaudeAccount(id: account.id)
              MacTelemetry.capture(.settingsChanged(setting: .accountSelected))
            }
          } onReauth: {
            login.start(accountId: account.id, host: host) { await store.refreshClaudeAccounts() }
          } onRename: {
            renaming = account
          } onRemove: {
            removing = account
          }
        }
      }

      ClaudeLoginSection(login: login, firstAccount: accounts.isEmpty) {
        await store.refreshClaudeAccounts()
      }

      SettingsError(text: login.error ?? host.error)
    }
    .task {
      await store.refreshClaudeAccounts()
    }
    .onAppear {
      unobserve = store.observeIpc { channel, args, _ in
        login.handle(channel: channel, args: args)
        if channel.hasPrefix("claude-auth:") { Task { await store.refreshClaudeAccounts() } }
      }
    }
    .onDisappear { unobserve?() }
    .sheet(item: $renaming) { account in
      RenameAccountSheet(account: account) { label in
        await store.renameClaudeAccount(id: account.id, label: label)
        MacTelemetry.capture(.settingsChanged(setting: .accountRenamed))
      }
    }
    .confirmationDialog(
      "Remove \(removing.map(Self.name) ?? "account")?", isPresented: removingBinding,
      titleVisibility: .visible
    ) {
      Button("Remove", role: .destructive) {
        guard let account = removing else { return }
        Task {
          await store.removeClaudeAccount(id: account.id)
          MacTelemetry.capture(.settingsChanged(setting: .accountRemoved))
        }
      }
    } message: {
      Text("This signs the account out of Argus and forgets it.")
    }
  }

  private var removingBinding: Binding<Bool> {
    Binding(get: { removing != nil }, set: { if !$0 { removing = nil } })
  }

  static func name(_ account: RemoteClaudeAccount) -> String {
    account.label ?? account.email ?? "Signing in…"
  }
}

private struct AccountRow: View {
  @Environment(\.theme) private var theme
  let account: RemoteClaudeAccount
  let active: Bool
  let onSelect: () -> Void
  let onReauth: () -> Void
  let onRename: () -> Void
  let onRemove: () -> Void

  private static let plans = [
    "team": "Team", "pro": "Pro", "max": "Max", "enterprise": "Enterprise", "free": "Free",
  ]

  var body: some View {
    HStack(spacing: 10) {
      Button {
        if !active { onSelect() }
      } label: {
        identity
      }
      .buttonStyle(.argusPlain)
      .accessibilityLabel(active ? "Active account" : "Make active")
      Spacer()
      if account.needsReauth {
        Button("Sign In Again", action: onReauth)
      }
      Menu {
        Button("Rename…", action: onRename)
        Button("Remove…", role: .destructive, action: onRemove)
      } label: {
        Image(systemName: "ellipsis")
      }
      .menuStyle(.borderlessButton)
      .clickable()
      .fixedSize()
      .accessibilityLabel("Account actions")
    }
  }

  private var identity: some View {
    HStack(spacing: 10) {
      Image(systemName: active ? "checkmark.circle.fill" : "circle")
        .foregroundStyle(active ? theme.accent : theme.textMuted)
        .accessibilityLabel(active ? "Active" : "Inactive")
      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 6) {
          Text(AccountsSettingsTab.name(account))
          if let plan = account.subscriptionType {
            Text(Self.plans[plan] ?? plan).font(.scaled(.caption)).foregroundStyle(.secondary)
          }
          if account.needsReauth {
            Text("Signed out").font(.scaled(.caption).weight(.medium)).foregroundStyle(theme.error)
          } else if account.rateLimited {
            Text("Limit reached").font(.scaled(.caption).weight(.medium)).foregroundStyle(theme.warning)
          }
        }
        if let detail {
          Text(detail).font(.scaled(.caption)).foregroundStyle(.secondary)
        }
      }
      Spacer(minLength: 0)
    }
    .contentShape(Rectangle())
  }

  /// The org, plus the email when the label already took the title.
  private var detail: String? {
    let parts = [account.label != nil ? account.email : nil, account.orgName].compactMap { $0 }
    return parts.isEmpty ? nil : parts.joined(separator: " · ")
  }
}

private struct RenameAccountSheet: View {
  @Environment(\.dismiss) private var dismiss
  let account: RemoteClaudeAccount
  let save: (String) async -> Void
  @State private var label = ""

  var body: some View {
    Form {
      TextField("Name", text: $label, prompt: Text(account.email ?? account.id))
    }
    .formStyle(.grouped)
    .frame(width: 380)
    .toolbar {
      ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
      ToolbarItem(placement: .confirmationAction) {
        Button("Save") {
          Task {
            await save(label)
            dismiss()
          }
        }
        .disabled(label.trimmingCharacters(in: .whitespaces).isEmpty)
      }
    }
    .onAppear { label = account.label ?? "" }
  }
}
