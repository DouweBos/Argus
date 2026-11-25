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
    Button("Rename Symbol") {
      guard let document, let code = model.activeCodeSession else { return }
      Task { await LspRename.run(in: code, document: document) }
    }
    .keyboardShortcut(model.menuShortcut(.renameSymbol))
    .disabled(!language)
    Button("Format Document") { model.formatActiveCodeDocument() }
      .keyboardShortcut(model.menuShortcut(.formatDocument))
      .disabled(document?.isEditable != true)
    Button("Show Completions") {
      document?.focus()
      document?.perform(.triggerCompletion)
    }
    .keyboardShortcut(model.menuShortcut(.editor(.triggerCompletion)))
    .disabled(!language)
    Divider()
    ForEach(Self.editing, id: \.self) { command in
      EditorCommandButton(
        model: model, command: command, document: document, enabled: focused && document?.isEditable == true)
    }
    Divider()
    Button("Send Selection to Agent") { document?.sendSelectionToAgent() }
      .keyboardShortcut(model.menuShortcut(.sendSelection))
      .disabled(document == nil)
  }

  static let editing: [EditorCommand] = [
    .toggleLineComment, .toggleBlockComment, .indentLines, .outdentLines, .insertLineBelow, .insertLineAbove,
    .deleteLines,
  ]
}

/// A menu item for an `EditorCommand`, on its own key unless something else here owns it.
struct EditorCommandButton: View {
  let model: DesktopModel
  let command: EditorCommand
  let document: EditorDocument?
  var enabled = true

  var body: some View {
    // A chord (⌘K ⌘0) can't be a menu key; the editor handles it itself.
    Button(command.title) { document?.perform(command) }
      .keyboardShortcut(model.menuShortcut(.editor(command)))
      .disabled(document == nil || !enabled)
  }
}

/// File ▸ Save and Save All for the code view, as menu items so ⌘S reaches them from the editor.
struct CodeSaveCommands: View {
  let model: DesktopModel

  var body: some View {
    let code = model.activeCodeSession
    let path = model.activeCodePath
    Button("Save") {
      guard let code, let path else { return }
      Task { await code.save(path) }
    }
    .keyboardShortcut(model.menuShortcut(.save))
    .disabled(code == nil || path == nil)
    Button("Save All") {
      guard let code else { return }
      Task { _ = await code.saveAll() }
    }
    .keyboardShortcut(model.menuShortcut(.saveAll))
    .disabled(code == nil)
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
