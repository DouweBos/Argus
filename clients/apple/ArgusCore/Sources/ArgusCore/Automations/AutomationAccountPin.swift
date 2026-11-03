import ArgusKit

/// The Claude account an automation's runs are pinned to. Mirrors
/// `automationAccountOptions` / `runnerTakesAccountPin` in client-core.
public enum AutomationAccountPin {
  public struct Option: Hashable {
    /// Empty follows the computer's active account.
    public let value: String
    public let name: String
    public let hint: String?
  }

  /// Custom runners bring their own credentials; nil is the computer's default runner.
  public static func applies(toRunner runner: String?) -> Bool {
    runner == nil || runner == "claude-code"
  }

  /// With one account there's nothing to pick, but a set pin stays so it can be cleared.
  public static func offered(accounts: [RemoteClaudeAccount], pinned: String?) -> Bool {
    accounts.count > 1 || pinned != nil
  }

  /// "Default account" first, then every account, then a pin to one since signed out.
  public static func options(
    accounts: [RemoteClaudeAccount], activeId: String?, pinned: String?
  ) -> [Option] {
    let active = accounts.first { $0.id == activeId }
    var options = [
      Option(
        value: "", name: "Default account",
        hint: active.map { "Follows the computer: \($0.displayName)" }
          ?? "Follows the computer's active account")
    ]
    options += accounts.map {
      Option(value: $0.id, name: $0.displayName, hint: $0.subtitle.isEmpty ? nil : $0.subtitle)
    }
    if let pinned, !accounts.contains(where: { $0.id == pinned }) {
      options.append(
        Option(value: pinned, name: "Signed-out account", hint: "Runs fail until it is signed back in"))
    }
    return options
  }

  public static let pinnedCaption =
    "Runs only on this account, and never move to another one when its plan limit is reached."
}
