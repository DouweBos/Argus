import ArgusSyntax
import AppKit
@preconcurrency import CodeEditTextView
import Observation

/// One open file: the buffer, its undo history, decorations and the hooks the host wires up.
///
/// Created without a view; `CodeEditorView` attaches to it. Everything here works headless,
/// including `reveal`, which waits for the view to come on screen.
@MainActor @Observable public final class EditorDocument {
  public internal(set) var version = 0
  public internal(set) var isDirty = false
  public internal(set) var highlightStatus: HighlightStatus
  public internal(set) var caret = EditorPosition(line: 0, utf16Column: 0)
  /// The primary selection.
  public internal(set) var selection = EditorRange(EditorPosition(line: 0, utf16Column: 0))
  public var configuration: EditorConfiguration {
    didSet { if configuration != oldValue { engine.apply(configuration) } }
  }
  public var gitMarks: [GutterMark] = [] {
    didSet { onDecorationsChange?() }
  }
  public var diagnostics: [EditorDiagnostic] = [] {
    didSet { onDecorationsChange?() }
  }
  /// The file's session-relative path; a definition in the same file is revealed in place.
  public var relativePath: String?
  public var isEditable = true {
    didSet { engine.textView.isEditable = isEditable }
  }
  /// The in-editor find bar's state.
  public let find: FindModel
  /// The "Go to Line…" field is up.
  public var isGoToLineVisible = false
  /// The text view is its window's first responder: editor keys and menu items apply.
  public internal(set) var hasFocus = false
  /// Picks the comment tokens.
  public let language: SyntaxLanguage?

  @ObservationIgnored public var onTextChange: ((EditorTextChange) -> Void)?
  @ObservationIgnored public weak var languageProvider: EditorLanguageProvider?
  @ObservationIgnored public weak var actions: EditorActions?
  /// The app's own keys the editor takes ahead of typing: ⌥ shortcuts (⌥Z, ⇧⌥F) would otherwise
  /// insert a character before any menu saw them. Return false to let the key through.
  @ObservationIgnored public var hostShortcuts: [EditorShortcut: () -> Bool] = [:]

  @ObservationIgnored let engine: EditorEngine
  @ObservationIgnored var lineIndex: LineIndex
  @ObservationIgnored let highlighter: HighlightCoordinator
  @ObservationIgnored let gutter = GutterView()
  @ObservationIgnored private(set) lazy var interaction = EditorInteraction(document: self)
  @ObservationIgnored private(set) lazy var folding = FoldingController(document: self)
  @ObservationIgnored var savedText: NSString
  @ObservationIgnored var pendingReveal: PendingReveal?
  @ObservationIgnored var pendingChange: EditorRange?
  @ObservationIgnored var suppressIncrementalChanges = false
  @ObservationIgnored var onDecorationsChange: (() -> Void)?
  @ObservationIgnored private var selectionObserver: NSObjectProtocol?

  struct PendingReveal {
    var line: Int
    var column: Int?
    var highlight: Bool
  }

  public init(text: String, language: SyntaxLanguage?, configuration: EditorConfiguration) {
    self.configuration = configuration
    self.language = language
    engine = EditorEngine(text: text, configuration: configuration)
    let storage = engine.textStorage.string as NSString
    lineIndex = LineIndex(storage)
    savedText = storage.copy() as! NSString
    let highlighter = HighlightCoordinator(language: language, text: text)
    self.highlighter = highlighter
    highlightStatus = highlighter.status
    find = FindModel()
    find.document = self
    highlighter.attach(engine)
    engine.textView.delegate = self
    engine.textView.host = interaction
    engine.onViewportChange = { [weak self] in self?.viewportChanged() }
    gutter.document = self
    engine.install(gutter)
    engine.willReveal = { [weak self] range in self?.folding.reveal([range]) }
    folding.scheduleRefresh(after: .zero)
    selectionObserver = NotificationCenter.default.addObserver(
      forName: TextSelectionManager.selectionChangedNotification, object: engine.textView.selectionManager,
      queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated { self?.selectionChanged() }
    }
  }

  isolated deinit {
    if let selectionObserver { NotificationCenter.default.removeObserver(selectionObserver) }
  }

  // MARK: Reading

  public var text: String {
    _ = version
    return String(engine.textStorage.string)
  }

  var storage: NSString { engine.textStorage.string as NSString }

  public var selectedText: String? {
    _ = selection
    guard let range = engine.textView.selectionManager.textSelections.first?.range, range.length > 0 else { return nil }
    return storage.substring(with: range)
  }

  public var lineCount: Int {
    _ = version
    return lineIndex.lineCount
  }

  public func offset(of position: EditorPosition) -> Int {
    lineIndex.offset(of: position, in: storage)
  }

  public func position(of offset: Int) -> EditorPosition {
    lineIndex.position(of: offset)
  }

  func nsRange(_ range: EditorRange) -> NSRange {
    lineIndex.range(range, in: storage)
  }

  // MARK: Saving

  /// Makes the current text the saved baseline.
  public func markSaved() {
    savedText = storage.copy() as! NSString
    isDirty = false
  }

  /// Applies the save-time whitespace rules to the buffer (one undo group) and returns the text to write.
  public func textForSaving() -> String {
    let edits = SaveTransform.edits(for: storage, configuration: configuration)
    if !edits.isEmpty {
      replace(edits.map { ($0.range, $0.text) }, selectAfter: false)
    }
    return text
  }

  func recomputeDirty() {
    let current = storage
    isDirty = current.length != savedText.length || !current.isEqual(to: savedText as String)
  }

  // MARK: Selection

  private func selectionChanged() {
    let range = engine.textView.selectionManager.textSelections.first?.range ?? NSRange(location: 0, length: 0)
    let newSelection = lineIndex.editorRange(range)
    if newSelection != selection { selection = newSelection }
    let newCaret = newSelection.end
    if newCaret != caret { caret = newCaret }
    folding.selectionChanged(engine.textView.selectionManager.textSelections.map(\.range))
    interaction.selectionChanged()
    onDecorationsChange?()
  }

  public func select(_ range: EditorRange) {
    let ns = nsRange(range)
    engine.textView.selectionManager.setSelectedRange(ns)
    engine.center(ns)
  }

  func viewportChanged() {
    highlighter.viewportChanged()
    onDecorationsChange?()
  }

  /// Moves keyboard focus into the editor.
  public func focus() {
    engine.textView.window?.makeFirstResponder(engine.textView)
  }
}
