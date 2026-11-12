import ArgusCore
import ArgusUI
import SwiftUI

/// How Claude drafts commit messages and pull requests: the repository's own
/// conventions, or the user's rules. Instructions save when the field loses focus.
struct CommitMessageStyleSection: View {
  @Environment(HostSettingsModel.self) private var host
  @State private var draft = ""
  @FocusState private var focused: Bool

  var body: some View {
    SettingsGroup(
      "Drafted messages",
      footer: "Draft in the commit composer (⌥⌘G) and Fill In with Claude in the pull request sheet. "
        + "You can edit every draft before committing."
    ) {
      if let settings = host.settings {
        SettingsRow("Message style", description: description(settings)) {
          Picker("Message style", selection: style(settings)) {
            Text("Repository conventions").tag(ArgusProtocol.AppSettingsCommitMessageStyle.conventions)
            Text("Custom instructions").tag(ArgusProtocol.AppSettingsCommitMessageStyle.custom)
          }
        }
        if settings.commitMessageStyle == .custom {
          VStack(alignment: .leading, spacing: 4) {
            TextField(
              "Instructions", text: $draft,
              prompt: Text("Conventional Commits, imperative mood, a one-line subject under 72 characters…"),
              axis: .vertical
            )
            .lineLimit(3...8)
            .textFieldStyle(.roundedBorder)
            .focused($focused)
            .onChange(of: focused) { _, now in
              if !now { saveInstructions() }
            }
            SettingsCaption("Left empty, the repository's conventions apply.")
          }
        }
      } else {
        SettingsLoading()
      }
    }
    .onAppear { draft = host.settings?.commitMessageInstructions ?? "" }
    .onChange(of: host.settings?.commitMessageInstructions) { _, next in
      if !focused { draft = next ?? "" }
    }
    .onDisappear { saveInstructions() }
  }

  private func description(_ settings: ArgusProtocol.AppSettings) -> String {
    settings.commitMessageStyle == .custom
      ? "Follow your own rules, below."
      : "Match the repository's recent commit subjects and its CLAUDE.md / AGENTS.md."
  }

  private func style(_ settings: ArgusProtocol.AppSettings) -> Binding<ArgusProtocol.AppSettingsCommitMessageStyle> {
    Binding(
      get: { settings.commitMessageStyle ?? .conventions },
      set: { next in
        Task {
          await host.save(.commitMessageStyle, ["commit_message_style": .string(next.rawValue)]) {
            $0.commitMessageStyle = next
          }
        }
      })
  }

  private func saveInstructions() {
    let next = draft.trimmingCharacters(in: .whitespacesAndNewlines)
    guard host.settings != nil, next != (host.settings?.commitMessageInstructions ?? "") else { return }
    Task {
      await host.save(.commitMessageInstructions, ["commit_message_instructions": .string(next)]) {
        $0.commitMessageInstructions = next
      }
    }
  }
}
