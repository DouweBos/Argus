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
    QuickOpenCommands(model: model)
    Divider()
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

/// Quick open's three ways in, in the Go menu.
private struct QuickOpenCommands: View {
  let model: DesktopModel

  var body: some View {
    let code = model.activeCodeSession
    ForEach(QuickOpenModel.Entry.allCases, id: \.self) { entry in
      Button(entry.title) { model.toggleQuickOpen(entry) }
        .keyboardShortcut(entry.shortcut.key, modifiers: entry.shortcut.modifiers)
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
      .keyboardShortcut(CodeShortcuts.wordWrap.key, modifiers: CodeShortcuts.wordWrap.modifiers)
      .disabled(code == nil)
    Divider()
    let document = model.activeCodeDocument
    ForEach([EditorCommand.fold, .unfold, .foldAll, .unfoldAll], id: \.self) {
      EditorCommandButton(command: $0, document: document, enabled: document?.hasFocus == true)
    }
    Divider()
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

/// App keys the editor hands back before its own handling: on ⌥ they'd type a character first, and
/// quick open's must open from inside the editor too.
enum CodeShortcuts {
  static let wordWrap = EditorShortcut("z", .option)
  static let format = EditorShortcut("f", [.shift, .option])

  @MainActor static func install(on document: EditorDocument, store: CodeStore?) {
    var quickOpen: [EditorShortcut: () -> Bool] = [:]
    for entry in QuickOpenModel.Entry.allCases {
      quickOpen[entry.shortcut] = { [weak store] in
        store?.model?.toggleQuickOpen(entry)
        return store != nil
      }
    }
    document.hostShortcuts = quickOpen.merging([
      wordWrap: { [weak store] in
        store?.toggleWordWrap()
        return store != nil
      },
      format: { [weak store] in
        store?.model?.formatActiveCodeDocument()
        return store != nil
      },
    ]) { first, _ in first }
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
    case .files: "Go to File…"
    case .openQuickly: "Open Quickly…"
    case .workspaceSymbols: "Go to Symbol in Workspace…"
    }
  }

  /// ⌘P and ⌘T as VS Code has them, ⇧⌘O as Xcode does.
  var shortcut: EditorShortcut {
    switch self {
    case .files: EditorShortcut("p", .command)
    case .openQuickly: EditorShortcut("o", [.shift, .command])
    case .workspaceSymbols: EditorShortcut("t", .command)
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
