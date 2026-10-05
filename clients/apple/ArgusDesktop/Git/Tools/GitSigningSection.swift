import ArgusCore
import ArgusUI
import SwiftUI

/// Commit signing for one repository: `commit.gpgsign`, `gpg.format` and
/// `user.signingkey` in its local config — the desktop's Git signing section.
struct GitSigningSection: View {
  @Environment(HostStore.self) private var store
  /// Any session of the repository; its worktree shares the repo's config.
  let sessionId: String
  /// Runs on the panel's workspace when there is one, so its banner reports failures.
  var workspace: GitWorkspace?

  @State private var saved = GitSigningConfig()
  @State private var draft = GitSigningConfig()
  @State private var error: String?
  @State private var saving = false

  var body: some View {
    Section {
      Toggle("Sign every commit", isOn: $draft.enabled)
      Picker("Format", selection: $draft.format) {
        Text("Git default (GPG)").tag("")
        Text("GPG").tag("openpgp")
        Text("SSH").tag("ssh")
        Text("X.509").tag("x509")
      }
      TextField(
        "Signing key", text: $draft.key,
        prompt: Text(draft.format == "ssh" ? "Path to an SSH public key" : "GPG key id or fingerprint"))
    } header: {
      Text("Commit signing")
    } footer: {
      HStack {
        Text(error ?? "Written to this repository's .git/config; an empty key falls back to the global one.")
          .foregroundStyle(error == nil ? .secondary : .primary)
        Spacer()
        Button("Revert") { draft = saved }.disabled(draft == saved || saving)
        Button("Save") { save() }.disabled(draft == saved || saving)
      }
    }
    .task(id: sessionId) { await load() }
  }

  private func load() async {
    var values: [String: String] = [:]
    error = nil
    for key in GitSigningConfig.keys {
      switch await GitToolRead.request(
        store, ArgusProtocol.Commands.GitGetConfig.self, .init(id: sessionId, key: key))
      {
      case .success(let value): values[key] = value ?? ""
      case .failure(let failure): error = failure.message
      }
    }
    saved = GitSigningConfig(values)
    draft = saved
  }

  private func save() {
    let changes = draft.changes(from: saved)
    saving = true
    Task {
      var failed = false
      for (key, value) in changes {
        if let workspace {
          failed = await workspace.host(
            ArgusProtocol.Commands.GitSetConfig.self, .init(id: sessionId, key: key, value: value),
            label: "Saving \(key)", track: .config) == nil || failed
        } else {
          do {
            _ = try await store.backend?.request(
              ArgusProtocol.Commands.GitSetConfig.self, .init(id: sessionId, key: key, value: value))
          } catch {
            failed = true
            self.error = HostStore.describe(error)
          }
        }
      }
      if workspace == nil {
        MacTelemetry.capture(.gitUsed(action: .config, scope: "session", remote: false, success: !failed))
      }
      saving = false
      await load()
    }
  }
}

/// The three signing keys as the section edits them.
struct GitSigningConfig: Equatable {
  static let keys = ["commit.gpgsign", "gpg.format", "user.signingkey"]

  var enabled = false
  var format = ""
  var key = ""

  init() {}

  init(_ values: [String: String]) {
    enabled = values["commit.gpgsign"] == "true"
    format = values["gpg.format"] ?? ""
    key = values["user.signingkey"] ?? ""
  }

  /// What `git config` has to change; an empty value unsets the key.
  func changes(from old: GitSigningConfig) -> [(key: String, value: String)] {
    var out: [(String, String)] = []
    if enabled != old.enabled { out.append(("commit.gpgsign", enabled ? "true" : "")) }
    if format != old.format { out.append(("gpg.format", format)) }
    let trimmed = key.trimmingCharacters(in: .whitespaces)
    if trimmed != old.key { out.append(("user.signingkey", trimmed)) }
    return out
  }
}
