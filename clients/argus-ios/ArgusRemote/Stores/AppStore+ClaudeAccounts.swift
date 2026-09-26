import ArgusKit
import Foundation

/// The computer's Claude accounts: which plans are signed in, which one new
/// agents run as, and how to add, rename, forget or re-authenticate one.
///
/// A sign-in opens a browser on the computer, so the phone cannot complete it
/// the way the desktop does — it follows the attempt through
/// `claude_accounts.login` and finishes by pasting the code the CLI prints.
extension AppStore {
  // MARK: Reading

  func refreshClaudeAccounts() async {
    guard let transport else { return }
    struct Result: Decodable {
      let accounts: [RemoteClaudeAccount]
      let active_id: String
    }
    guard let result = try? await transport.request(
      .claudeAccountsList, EmptyParams(), as: Result.self) else { return }
    claudeAccounts = result.accounts
    activeClaudeAccountId = result.active_id
  }

  // MARK: Switching

  /// Make this the account every new agent authenticates as. Running agents
  /// keep theirs — the switch only takes effect on the next spawn.
  func setActiveClaudeAccount(id: String) async {
    guard let transport else { return }
    struct Params: Encodable { let id: String }
    do {
      try await transport.request(
        .claudeAccountsSetActive, Params(id: id), as: IgnoredResult.self)
      activeClaudeAccountId = id
      await refreshClaudeAccounts()
    } catch {
      report(error)
    }
  }

  // MARK: Adding and forgetting

  /// Open the computer's browser and watch what it reports. The account it
  /// lands on isn't known until the refresh arrives, so the list simply fills
  /// in — `claude_accounts.add` is the branch for a brand new one.
  func addClaudeAccount(useConsole: Bool) async {
    guard let transport else { return }
    struct Params: Encodable { let use_console: Bool }
    struct Result: Decodable { let url: String }
    do {
      let result = try await transport.request(
        .claudeAccountsAdd, Params(use_console: useConsole), as: Result.self)
      claudeLogin = RemoteClaudeLoginState(pending: true, needsCode: false)
      openLoginURL(result.url)
      await refreshClaudeAccounts()
    } catch {
      claudeLogin = nil
      report(error)
    }
  }

  func removeClaudeAccount(id: String) async {
    guard let transport else { return }
    struct Params: Encodable { let id: String }
    do {
      try await transport.request(
        .claudeAccountsRemove, Params(id: id), as: IgnoredResult.self)
      claudeAccounts?.removeAll { $0.id == id }
      await refreshClaudeAccounts()
    } catch {
      report(error)
    }
  }

  func renameClaudeAccount(id: String, label: String) async {
    guard let transport else { return }
    let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    struct Params: Encodable {
      let id: String
      let label: String
    }
    // Patch locally first so the row keeps the name the user typed even if the
    // round trip's echo arrives after they've moved on.
    if let index = claudeAccounts?.firstIndex(where: { $0.id == id }) {
      claudeAccounts?[index].label = trimmed
    }
    do {
      try await transport.request(
        .claudeAccountsRename, Params(id: id, label: trimmed),
        as: IgnoredResult.self)
    } catch {
      await refreshClaudeAccounts()
      report(error)
    }
  }

  // MARK: Signing in again

  /// Re-authenticate an account whose credentials died. Same browser dance as
  /// adding one, onto an entry that already exists.
  func startClaudeLogin(accountId: String?) async {
    guard let transport else { return }
    struct Params: Encodable {
      let account_id: String?
      let use_console: Bool?
    }
    struct Result: Decodable { let url: String }
    do {
      let result = try await transport.request(
        .claudeAccountsLoginStart,
        Params(account_id: accountId, use_console: nil),
        as: Result.self)
      claudeLogin = RemoteClaudeLoginState(pending: true, needsCode: false)
      openLoginURL(result.url)
    } catch {
      claudeLogin = nil
      report(error)
    }
  }

  /// Give up on the attempt. The computer drops a placeholder account it minted
  /// for it, so nothing dead is left in the list.
  func cancelClaudeLogin() async {
    guard let transport else { return }
    try? await transport.request(
      .claudeAccountsLoginCancel, EmptyParams(), as: IgnoredResult.self)
    claudeLogin = nil
    await refreshClaudeAccounts()
  }

  /// Finish a sign-in with the code the CLI printed. Nil means it is still
  /// waiting or the code was wrong — `error` on the state says which.
  func submitClaudeLoginCode(_ code: String) async {
    guard let transport else { return }
    struct Params: Encodable { let code: String }
    struct Result: Decodable {
      let ok: Bool
      let error: String?
    }
    do {
      let result = try await transport.request(
        .claudeAccountsLoginSubmitCode,
        Params(code: code.trimmingCharacters(in: .whitespacesAndNewlines)),
        as: Result.self)
      if result.ok {
        claudeLogin = RemoteClaudeLoginState(pending: false, needsCode: false, ok: true)
        await refreshClaudeAccounts()
      } else {
        // The child exits on a wrong code, so this attempt is over rather than
        // still waiting — the user starts a fresh sign-in.
        claudeLogin = RemoteClaudeLoginState(
          pending: false, needsCode: false, ok: false, error: result.error)
      }
    } catch {
      report(error)
    }
  }

  /// Ask the computer where its sign-in has got to. The push event covers the
  /// normal case; this is for a screen opened mid-attempt.
  func loadClaudeLoginStatus() async {
    guard let transport else { return }
    guard let state = try? await transport.request(
      .claudeAccountsLoginStatus, EmptyParams(), as: RemoteClaudeLoginState.self),
      state.pending
    else { return }
    claudeLogin = state
  }

  /// The URL is for reading, not tapping — it authorises on the computer's
  /// browser, so following it here cannot complete anything. Surfacing it is
  /// what lets the user open the same link on that machine.
  private func openLoginURL(_ url: String) {
    lastError = "Sign in opened on your computer: \(url)"
  }
}
