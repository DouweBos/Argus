import ArgusEditor
import SwiftUI

/// The Selection menu: carets and whole lines, as VS Code's. Needs the code view's editor focused.
struct CodeSelectionCommands: View {
  let model: DesktopModel

  var body: some View {
    let document = model.activeCodeDocument
    let focused = document?.hasFocus == true
    ForEach([EditorCommand.selectLine, .addNextOccurrence, .selectAllOccurrences, .addCursorAbove, .addCursorBelow], id: \.self) {
      EditorCommandButton(command: $0, document: document, enabled: focused)
    }
    Divider()
    ForEach([EditorCommand.moveLinesUp, .moveLinesDown, .copyLinesUp, .copyLinesDown], id: \.self) {
      EditorCommandButton(command: $0, document: document, enabled: focused && document?.isEditable == true)
    }
  }
}

/// The Go menu: history, editor tabs, definitions, lines and problems in the code view.
struct CodeGoCommands: View {
  let model: DesktopModel

  var body: some View {
    let code = model.activeCodeSession
    let document = model.activeCodeDocument
    let language = document?.languageProvider != nil
    Button("Back") { model.goBack() }
      .keyboardShortcut("-", modifiers: .control)
      .disabled(code == nil || !model.canGoBack)
    Button("Forward") { model.goForward() }
      .keyboardShortcut("-", modifiers: [.control, .shift])
      .disabled(code == nil || !model.canGoForward)
    Divider()
    Button("Next Editor") { code?.cycleEditor(by: 1, active: model.activeCodePath) }
      .keyboardShortcut(.rightArrow, modifiers: [.option, .command])
      .disabled((code?.tabs.tabs.count ?? 0) < 2)
    Button("Previous Editor") { code?.cycleEditor(by: -1, active: model.activeCodePath) }
      .keyboardShortcut(.leftArrow, modifiers: [.option, .command])
      .disabled((code?.tabs.tabs.count ?? 0) < 2)
    Divider()
    EditorCommandButton(command: .goToDefinition, document: document, enabled: language)
    Button("Find References") {
      guard let document, let code else { return }
      Task { await LspReferences.run(in: code, document: document) }
    }
    .keyboardShortcut(.function(12), modifiers: .shift)
    .disabled(!language)
    EditorCommandButton(command: .goToLine, document: document)
    EditorCommandButton(command: .jumpToBracket, document: document)
    Divider()
    EditorCommandButton(command: .nextProblem, document: document, enabled: document?.diagnostics.isEmpty == false)
    EditorCommandButton(command: .previousProblem, document: document, enabled: document?.diagnostics.isEmpty == false)
  }
}

/// The code view's panes and wrapping, in the View menu.
struct CodeViewCommands: View {
  let model: DesktopModel
  private let preferences = AppPreferences.shared

  var body: some View {
    let code = model.activeCodeSession
    Toggle("Word Wrap", isOn: wordWrap)
      .keyboardShortcut(CodeShortcuts.wordWrap.key, modifiers: CodeShortcuts.wordWrap.modifiers)
      .disabled(code == nil)
    Button("Toggle Navigator") { code?.navigatorVisible.toggle() }
      .keyboardShortcut("b", modifiers: .command)
      .disabled(code == nil)
    Button("Show Files") { code?.showNavigator(.files) }
      .keyboardShortcut("e", modifiers: [.shift, .command])
      .disabled(code == nil)
    Button("Show Changes") { code?.showNavigator(.changes) }
      .keyboardShortcut("g", modifiers: [.control, .shift])
      .disabled(code == nil)
    Button("Toggle Problems") {
      guard let code else { return }
      model.languages.client(code.sessionId).problemsExpanded.toggle()
    }
    .keyboardShortcut("m", modifiers: [.shift, .command])
    .disabled(code == nil)
    Button("Toggle Terminal") { model.terminalPanelVisible.toggle() }
      .keyboardShortcut("`", modifiers: .control)
      .disabled(code == nil)
  }

  private var wordWrap: Binding<Bool> {
    Binding(
      get: { preferences.editorWrapLines },
      set: { if $0 != preferences.editorWrapLines { model.code.toggleWordWrap() } })
  }
}

/// The app's keys the editor must take before typing: on ⌥ they'd insert a character first.
enum CodeShortcuts {
  static let wordWrap = EditorShortcut("z", .option)
  static let format = EditorShortcut("f", [.shift, .option])

  @MainActor static func install(on document: EditorDocument, store: CodeStore?) {
    document.hostShortcuts = [
      wordWrap: { [weak store] in
        store?.toggleWordWrap()
        return store != nil
      },
      format: { [weak document] in
        guard let provider = document?.languageProvider as? LspDocumentProvider else { return false }
        Task { _ = await provider.format() }
        return true
      },
    ]
  }
}

extension CodeStore {
  /// ⌥Z: flips the Wrap lines setting for every open file.
  func toggleWordWrap() {
    AppPreferences.shared.editorWrapLines.toggle()
    applySettings()
  }
}

extension DesktopModel {
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
