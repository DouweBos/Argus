import ArgusEditor
import SwiftUI

/// The Editor menu: language and agent actions on the file the code view shows. Off anywhere else.
struct CodeCommands: View {
  let model: DesktopModel

  var body: some View {
    let document = model.activeCodeDocument
    Button("Go to Definition") { document?.goToDefinition() }
      .keyboardShortcut("j", modifiers: [.command, .control])
      .disabled(document?.languageProvider == nil)
    Button("Show Completions") {
      document?.focus()
      document?.triggerCompletion()
    }
    .keyboardShortcut(.space, modifiers: .control)
    .disabled(document?.languageProvider == nil)
    Divider()
    Button("Send Selection to Agent") { document?.sendSelectionToAgent() }
      .keyboardShortcut("l", modifiers: [.command, .shift])
      .disabled(document == nil)
  }
}

extension DesktopModel {
  /// The buffer on screen in the code view, if the route shows one.
  var activeCodeDocument: EditorDocument? {
    guard case .sessionCode(let id, let path?, _) = route else { return nil }
    return code.sessions[id]?.files[path]?.document
  }
}
