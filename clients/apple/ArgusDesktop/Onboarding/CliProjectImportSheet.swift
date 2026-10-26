import ArgusCore
import ArgusKit
import ArgusUI
import SwiftUI

/// Import projects from Claude Code: the directories the CLI has chats for,
/// ticked to add as projects. Their chats then import into history.
struct CliProjectImportSheet: View {
  @Environment(DesktopModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @Environment(\.theme) private var theme
  @State private var picker = CliProjectPicker(source: .dialog)

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      VStack(alignment: .leading, spacing: 4) {
        Text("Import projects from Claude Code").font(.scaled(.title2).weight(.semibold))
        Text("Projects you've used the Claude Code CLI in, with how many chats each has.")
          .foregroundStyle(theme.textSecondary)
      }
      content.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
      HStack {
        Spacer()
        Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
        Button(CliProjectImport.importLabel(picker.picked.count)) { Task { await runImport() } }
          .buttonStyle(.borderedProminent)
          .keyboardShortcut(.defaultAction)
          .disabled(picker.picked.isEmpty || picker.importing)
      }
    }
    .padding(24)
    .frame(width: 600, height: 520)
    .task {
      guard let backend = model.backend else { return }
      await picker.load(backend)
    }
  }

  @ViewBuilder private var content: some View {
    if let error = picker.error {
      Text(error).foregroundStyle(theme.error).textSelection(.enabled)
    } else if let scan = picker.scan {
      if scan.candidates.isEmpty {
        Text("No Claude Code projects found")
          .foregroundStyle(theme.textMuted)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else {
        CliProjectList(picker: picker)
      }
    } else {
      ProgressView("Looking through your Claude Code chats…").frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }

  private func runImport() async {
    guard let backend = model.backend else { return }
    if await picker.importPicked(backend) { dismiss() }
  }
}
