import ArgusEditor
import SwiftUI

/// The Editor menu: editing, language and agent actions on the file the code view shows,
/// with VS Code's keys. Off anywhere else; editing needs the editor focused.
struct CodeCommands: View {
  let model: DesktopModel

  var body: some View {
    let document = model.activeCodeDocument
    let focused = document?.hasFocus == true
    let language = document?.languageProvider != nil
    Button("Rename Symbol…") {
      guard let document, let code = model.activeCodeSession else { return }
      Task { await LspRename.run(in: code, document: document) }
    }
    .keyboardShortcut(.function(2), modifiers: [])
    .disabled(!language)
    Button("Format Document") {
      guard let provider = document?.languageProvider as? LspDocumentProvider else { return }
      Task { _ = await provider.format() }
    }
    .keyboardShortcut(CodeShortcuts.format.key, modifiers: CodeShortcuts.format.modifiers)
    .disabled(!language)
    Button("Show Completions") {
      document?.focus()
      document?.perform(.triggerCompletion)
    }
    .keyboardShortcut(.space, modifiers: .control)
    .disabled(!language)
    Divider()
    ForEach(Self.editing, id: \.self) { command in
      EditorCommandButton(command: command, document: document, enabled: focused && document?.isEditable == true)
    }
    Divider()
    Button("Send Selection to Agent") { document?.sendSelectionToAgent() }
      .keyboardShortcut("l", modifiers: [.command, .option])
      .disabled(document == nil)
  }

  static let editing: [EditorCommand] = [
    .toggleLineComment, .toggleBlockComment, .indentLines, .outdentLines, .insertLineBelow, .insertLineAbove,
    .deleteLines,
  ]
}

/// A menu item for an `EditorCommand`, on its own key.
struct EditorCommandButton: View {
  let command: EditorCommand
  let document: EditorDocument?
  var enabled = true

  var body: some View {
    Button(command.title) { document?.perform(command) }
      .keyboardShortcut(command.shortcut.key, modifiers: command.shortcut.modifiers)
      .disabled(document == nil || !enabled)
  }
}

extension DesktopModel {
  var activeCodeSession: CodeSession? {
    guard case .sessionCode(let id, _, _) = route else { return nil }
    return code.sessions[id]
  }

  /// The buffer on screen in the code view, if the route shows one.
  var activeCodeDocument: EditorDocument? {
    guard case .sessionCode(let id, let path?, _) = route else { return nil }
    return code.sessions[id]?.files[path]?.document
  }

  /// The code view's editor has keyboard focus, so ⌘[ and ⌘] indent rather than go back and forward.
  var codeEditorFocused: Bool { activeCodeDocument?.hasFocus == true }
}
