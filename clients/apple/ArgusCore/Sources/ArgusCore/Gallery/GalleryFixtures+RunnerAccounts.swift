import ArgusKit

/// The Accounts page: two Claude accounts, Codex signed in, Cursor installed
/// but signed out, Gemini missing, and a custom agent that can't be asked.
extension GalleryFixtures {
  public static var runnerAccountRecords: [[String: Any]] {
    [
      runnerAccount(
        "codex", "Codex", status: "signed_in", account: "ChatGPT",
        setup: ["installCommand": "npm install -g @openai/codex", "loginCommand": "codex login", "logoutCommand": "codex logout"]),
      runnerAccount(
        "cursor", "Cursor", status: "signed_out",
        setup: [
          "installCommand": "curl https://cursor.com/install -fsS | bash", "loginCommand": "cursor-agent login",
          "logoutCommand": "cursor-agent logout",
        ]),
      runnerAccount("custom:goose", "Goose", status: "unknown", isCustom: true, canProbe: false, setup: nil),
      runnerAccount(
        "gemini", "Gemini CLI", status: "not_installed", canProbe: false,
        detail: "Gemini CLI isn't installed. Install it with `npm install -g @google/gemini-cli`.",
        setup: ["installCommand": "npm install -g @google/gemini-cli", "loginCommand": "gemini"]),
    ]
  }

  public static var runnerAccounts: [String: String] {
    [
      RemoteMethod.claudeAccountsList.rawValue: claudeAccounts,
      RemoteMethod.runnersAccounts.rawValue: GalleryJSON.encode(["runners": runnerAccountRecords]),
      ArgusProtocol.Commands.LlmRunnerAccounts.name: GalleryJSON.encode(runnerAccountRecords),
    ]
  }

  private static func runnerAccount(
    _ id: String, _ name: String, status: String, account: String? = nil, isCustom: Bool = false,
    canProbe: Bool = true, detail: String? = nil, setup: [String: String]?
  ) -> [String: Any] {
    var record: [String: Any] = [
      "id": id, "displayName": name, "isCustom": isCustom, "status": status, "canProbe": canProbe,
    ]
    if let account { record["account"] = account }
    if let detail { record["detail"] = detail }
    if let setup { record["setup"] = setup }
    return record
  }
}
