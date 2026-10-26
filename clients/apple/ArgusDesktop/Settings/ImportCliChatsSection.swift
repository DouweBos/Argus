import ArgusCore
import SwiftUI

/// Chats run with the plain Claude Code CLI, pulled into each project's history.
struct ImportCliChatsSection: View {
  @Environment(HostSettingsModel.self) private var host
  @State private var importing = false
  @State private var result: String?

  var body: some View {
    Section("Claude Code chats") {
      if let settings = host.settings {
        VStack(alignment: .leading, spacing: 4) {
          Toggle("Import chats from the Claude Code CLI", isOn: enabled(settings))
          SettingsCaption(
            "Show chats you ran with the Claude Code CLI in each project's history, so you can resume them here.")
        }
        HStack {
          Button(importing ? "Importing…" : "Import now", action: runImport)
            .disabled(importing)
          if let result {
            Text(result).font(.callout).foregroundStyle(.secondary)
          }
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
