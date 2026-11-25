import ArgusCore
import ArgusEditor
import SwiftUI

/// The Selection menu: carets and whole lines, as VS Code's. Needs the code view's editor focused.
struct CodeSelectionCommands: View {
  let model: DesktopModel

  var body: some View {
    let document = model.activeCodeDocument
    let focused = document?.hasFocus == true
    ForEach([EditorCommand.selectLine, .addNextOccurrence, .selectAllOccurrences, .addCursorAbove, .addCursorBelow], id: \.self) {
      EditorCommandButton(model: model, command: $0, document: document, enabled: focused)
    }
    Divider()
    ForEach([EditorCommand.moveLinesUp, .moveLinesDown, .copyLinesUp, .copyLinesDown], id: \.self) {
      EditorCommandButton(model: model, command: $0, document: document, enabled: focused && document?.isEditable == true)
    }
  }
}

/// The Go menu's code view half: quick open, editor tabs, definitions, lines and problems.
struct CodeGoCommands: View {
  let model: DesktopModel

  var body: some View {
    let code = model.activeCodeSession
    let document = model.activeCodeDocument
    let language = document?.languageProvider != nil
    QuickOpenCommands(model: model)
    Divider()
    Button("Next Editor") { code?.cycleEditor(by: 1, active: model.activeCodePath) }
      .keyboardShortcut(model.menuShortcut(.nextEditor))
      .disabled((code?.tabs.tabs.count ?? 0) < 2)
    Button("Previous Editor") { code?.cycleEditor(by: -1, active: model.activeCodePath) }
      .keyboardShortcut(model.menuShortcut(.previousEditor))
      .disabled((code?.tabs.tabs.count ?? 0) < 2)
    Divider()
    EditorCommandButton(model: model, command: .goToDefinition, document: document, enabled: language)
    Button("Find References") {
      guard let document, let code else { return }
      Task { await LspReferences.run(in: code, document: document) }
    }
    .keyboardShortcut(model.menuShortcut(.findReferences))
    .disabled(!language)
    EditorCommandButton(model: model, command: .goToLine, document: document)
    EditorCommandButton(model: model, command: .jumpToBracket, document: document)
    Divider()
    EditorCommandButton(
      model: model, command: .nextProblem, document: document, enabled: document?.diagnostics.isEmpty == false)
    EditorCommandButton(
      model: model, command: .previousProblem, document: document, enabled: document?.diagnostics.isEmpty == false)
  }
}

/// Quick open's three ways in, in the Go menu.
private struct QuickOpenCommands: View {
  let model: DesktopModel

  var body: some View {
    let code = model.activeCodeSession
    ForEach(QuickOpenModel.Entry.allCases, id: \.self) { entry in
      Button(entry.title) { model.toggleQuickOpen(entry) }
        .keyboardShortcut(model.menuShortcut(.quickOpen(entry)))
        .disabled(code == nil)
    }
  }
}

/// The code view's panes and wrapping, in the View menu.
struct CodeViewCommands: View {
  let model: DesktopModel
  private let preferences = AppPreferences.shared

  var body: some View {
    let code = model.activeCodeSession
    Toggle("Word Wrap", isOn: wordWrap)
      .keyboardShortcut(model.menuShortcut(.wordWrap))
      .disabled(code == nil)
    Divider()
    let document = model.activeCodeDocument
    ForEach([EditorCommand.fold, .unfold, .foldAll, .unfoldAll], id: \.self) {
      EditorCommandButton(model: model, command: $0, document: document, enabled: document?.hasFocus == true)
    }
    Divider()
    Button("Toggle Navigator") { code?.navigatorVisible.toggle() }
      .keyboardShortcut(model.menuShortcut(.toggleNavigator))
      .disabled(code == nil)
    Button("Show Files") { code?.showNavigator(.files) }
      .keyboardShortcut(model.menuShortcut(.showFiles))
      .disabled(code == nil)
    Button("Show Changes") { code?.showNavigator(.changes) }
      .keyboardShortcut(model.menuShortcut(.showChanges))
      .disabled(code == nil)
    Button("Toggle Problems") { model.toggleProblems() }
      .keyboardShortcut(model.menuShortcut(.toggleProblems))
      .disabled(code == nil)
    Button("Toggle Terminal") { model.togglePanelTab(.terminal, via: .shortcut) }
      .keyboardShortcut(model.menuShortcut(.toggleTerminal))
      .disabled(code == nil)
  }

  private var wordWrap: Binding<Bool> {
    Binding(
      get: { preferences.editorWrapLines },
      set: { if $0 != preferences.editorWrapLines { model.code.toggleWordWrap() } })
  }
}

/// App keys the editor takes ahead of its own handling: on ⌥ they'd type a character first, and
/// quick open's must open from inside the editor too. Read from the keymap on each press.
enum CodeShortcuts {
  @MainActor static func install(on document: EditorDocument, store: CodeStore?) {
    document.hostKeys = { [weak store] event in
      guard let store, let chord = KeyChord(event: event) else { return false }
      let keymap = AppPreferences.shared.shortcutKeymap
      for entry in QuickOpenModel.Entry.allCases where keymap.chord(for: .quickOpen(entry)) == chord {
        store.model?.toggleQuickOpen(entry)
        return true
      }
      if keymap.chord(for: .wordWrap) == chord {
        store.toggleWordWrap()
        return true
      }
      if keymap.chord(for: .formatDocument) == chord {
        store.model?.formatActiveCodeDocument()
        return true
      }
      return false
    }
  }
}

extension CodeStore {
  /// ⌥Z: flips the Wrap lines setting for every open file.
  func toggleWordWrap() {
    AppPreferences.shared.editorWrapLines.toggle()
    applySettings()
  }
}

extension QuickOpenModel.Entry: CaseIterable {
  static let allCases: [Self] = [.files, .openQuickly, .workspaceSymbols]

  var title: String {
    switch self {
    case .files: "Go to File"
    case .openQuickly: "Open Quickly"
    case .workspaceSymbols: "Go to Symbol in Workspace"
    }
  }

}

extension DesktopModel {
  /// Shows quick open in the code view; the same key again closes it.
  func toggleQuickOpen(_ entry: QuickOpenModel.Entry) {
    guard let code = activeCodeSession else { return }
    if code.quickOpenVisible, code.quickOpen.entry == entry {
      code.quickOpen.dismiss()
    } else {
      code.quickOpen.present(entry, activePath: activeCodePath)
    }
  }

  /// The file the code view shows.
  var activeCodePath: String? {
    guard case .sessionCode(_, let path, _) = route else { return nil }
    return path
  }
}

extension CodeSession {
  /// ⌥⌘→ / ⌥⌘←: the next or previous tab, wrapping.
  func cycleEditor(by delta: Int, active: String?) {
    let paths = tabs.paths
    guard paths.count > 1, let active, let index = paths.firstIndex(of: active) else { return }
    navigate(to: paths[(index + delta + paths.count) % paths.count], source: .history)
  }

  /// ⇧⌘E / ⌃⇧G: shows the navigator on one of its lists.
  func showNavigator(_ mode: CodeNavigatorMode) {
    navigatorVisible = true
    navigatorMode = mode
  }
}
