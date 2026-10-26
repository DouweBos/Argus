import ArgusCore
import ArgusUI
import SwiftUI

/// Chats run with the plain Claude Code CLI, pulled into each project's history.
struct ImportCliChatsSection: View {
  @Environment(HostSettingsModel.self) private var host
  @State private var importing = false
  @State private var result: String?

  var body: some View {
    SettingsGroup("Claude Code chats") {
      if let settings = host.settings {
        SettingsToggleRow(
          "Import chats from the Claude Code CLI",
          description: "Show chats you ran with the Claude Code CLI in each project's history, so you can resume them here.",
          isOn: enabled(settings))
        SettingsRow("Import now", description: result ?? "Pull in chats you've had since the last import.") {
          Button(importing ? "Importing…" : "Import Now", action: runImport)
            .disabled(importing)
        }
      } else {
        SettingsLoading()
      }
    }
  }

  private func enabled(_ settings: ArgusProtocol.AppSettings) -> Binding<Bool> {
    Binding(
      get: { settings.importCliChats != false },
      set: { next in
        Task {
          await host.save(.importCliChats, ["import_cli_chats": .bool(next)]) { $0.importCliChats = next }
        }
      })
  }

  private func runImport() {
    importing = true
    result = nil
    Task {
      defer { importing = false }
      guard let outcome = await host.run(ArgusProtocol.Commands.ImportCliChats.self, EmptyParams()) else { return }
      let count = Int(outcome.imported)
      result = count == 0 ? "Nothing new to import" : "Imported \(count) chat\(count == 1 ? "" : "s")"
    }
  }
}
