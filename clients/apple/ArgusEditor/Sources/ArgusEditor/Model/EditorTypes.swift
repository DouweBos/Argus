import ArgusSyntax
import CoreGraphics
import Foundation

public struct EditorConfiguration: Equatable, Sendable {
  public var fontName: String?
  public var fontSize: CGFloat
  public var tabWidth: Int
  public var insertSpaces: Bool
  public var wrapLines: Bool
  public var showInvisibles: Bool
  public var trimTrailingWhitespaceOnSave: Bool
  public var insertFinalNewline: Bool

  public init(
    fontName: String? = nil,
    fontSize: CGFloat = 13,
    tabWidth: Int = 4,
    insertSpaces: Bool = true,
    wrapLines: Bool = false,
    showInvisibles: Bool = false,
    trimTrailingWhitespaceOnSave: Bool = false,
    insertFinalNewline: Bool = false
  ) {
    self.fontName = fontName
    self.fontSize = fontSize
    self.tabWidth = tabWidth
    self.insertSpaces = insertSpaces
    self.wrapLines = wrapLines
    self.showInvisibles = showInvisibles
    self.trimTrailingWhitespaceOnSave = trimTrailingWhitespaceOnSave
    self.insertFinalNewline = insertFinalNewline
  }

  public static let `default` = EditorConfiguration()

  /// One indentation step as typed by the tab key.
  public var indentUnit: String {
    insertSpaces ? String(repeating: " ", count: max(1, tabWidth)) : "\t"
  }
}

/// 0-based line and UTF-16 column, the same shape LSP uses.
public struct EditorPosition: Hashable, Sendable, Comparable {
  public var line: Int
  public var utf16Column: Int

  public init(line: Int, utf16Column: Int) {
    self.line = line
    self.utf16Column = utf16Column
  }

  public static func < (lhs: EditorPosition, rhs: EditorPosition) -> Bool {
    (lhs.line, lhs.utf16Column) < (rhs.line, rhs.utf16Column)
  }
}

public struct EditorRange: Hashable, Sendable {
  public var start: EditorPosition
  public var end: EditorPosition

  public init(start: EditorPosition, end: EditorPosition) {
    self.start = start
    self.end = end
  }

  public init(_ position: EditorPosition) {
    self.init(start: position, end: position)
  }

  public var isEmpty: Bool { start == end }
}

/// One edit, with `range` expressed in the text *before* the edit — what LSP's
/// incremental `didChange` expects.
public struct EditorTextChange: Sendable, Equatable {
  public var range: EditorRange
  public var text: String
  public var version: Int
  /// True when the change replaces the whole document (reload, external change).
  public var isFullReplace: Bool

  public init(range: EditorRange, text: String, version: Int, isFullReplace: Bool = false) {
    self.range = range
    self.text = text
    self.version = version
    self.isFullReplace = isFullReplace
  }
}

public enum HighlightStatus: Equatable, Sendable {
  case highlighted(SyntaxLanguage)
  case plainText
  case disabled(SyntaxLimits.DisabledReason)
}

public enum DiagnosticSeverity: Int, Comparable, Sendable, CaseIterable {
  // LSP's numbering: lower is more severe.
  case error = 1, warning, info, hint

  public static func < (lhs: DiagnosticSeverity, rhs: DiagnosticSeverity) -> Bool {
    lhs.rawValue < rhs.rawValue
  }
}

public struct EditorDiagnostic: Identifiable, Hashable, Sendable {
  public var id: String
  public var range: EditorRange
  public var severity: DiagnosticSeverity
  public var message: String
  public var source: String?
  public var code: String?

  public init(
    id: String = UUID().uuidString, range: EditorRange, severity: DiagnosticSeverity, message: String,
    source: String? = nil, code: String? = nil
  ) {
    self.id = id
    self.range = range
    self.severity = severity
    self.message = message
    self.source = source
    self.code = code
  }
}

public struct GutterMark: Identifiable, Hashable, Sendable {
  public enum Kind: String, Hashable, Sendable { case added, modified, deleted }

  public var id: String
  public var kind: Kind
  /// 0-based lines in the current text. A deletion is an empty range at the line below the removed lines.
  public var lines: Range<Int>
  /// The original lines, for the peek popover.
  public var baseLines: [String]

  public init(id: String? = nil, kind: Kind, lines: Range<Int>, baseLines: [String] = []) {
    self.id = id ?? "\(kind.rawValue):\(lines.lowerBound)-\(lines.upperBound)"
    self.kind = kind
    self.lines = lines
    self.baseLines = baseLines
  }
}

/// A subset of LSP's `CompletionItemKind`.
public enum EditorCompletionKind: String, Hashable, Sendable {
  case text, method, function, constructor, field, variable, `class`, interface, module, property,
    unit, value, `enum`, keyword, snippet, color, file, reference, folder, enumMember, constant,
    `struct`, event, `operator`, typeParameter
}

public struct EditorCompletionItem: Identifiable, @unchecked Sendable {
  public var id: String
  public var label: String
  public var detail: String?
  /// Markdown.
  public var documentation: String?
  public var kind: EditorCompletionKind
  public var insertText: String
  public var replaceRange: EditorRange?
  public var sortText: String?
  public var filterText: String?
  /// Whatever the provider needs to resolve the item later.
  public var opaque: AnyHashable?
  /// Edits elsewhere in the file applied with the item, such as an auto-import; ranges in the text
  /// as it was when the list opened.
  public var additionalEdits: [EditorTextEdit]

  public init(
    id: String = UUID().uuidString, label: String, detail: String? = nil, documentation: String? = nil,
    kind: EditorCompletionKind = .text, insertText: String? = nil, replaceRange: EditorRange? = nil,
    sortText: String? = nil, filterText: String? = nil, opaque: AnyHashable? = nil,
    additionalEdits: [EditorTextEdit] = []
  ) {
    self.id = id
    self.label = label
    self.detail = detail
    self.documentation = documentation
    self.kind = kind
    self.insertText = insertText ?? label
    self.replaceRange = replaceRange
    self.sortText = sortText
    self.filterText = filterText
    self.opaque = opaque
    self.additionalEdits = additionalEdits
  }
}

/// Replace `range` (in the current text) with `text`.
public struct EditorTextEdit: Hashable, Sendable {
  public var range: EditorRange
  public var text: String

  public init(range: EditorRange, text: String) {
    self.range = range
    self.text = text
  }
}

public struct EditorHover: Sendable, Equatable {
  public var markdown: String
  public var range: EditorRange?

  public init(markdown: String, range: EditorRange? = nil) {
    self.markdown = markdown
    self.range = range
  }
}

public struct EditorLocation: Hashable, Sendable {
  public var relativePath: String
  public var range: EditorRange

  public init(relativePath: String, range: EditorRange) {
    self.relativePath = relativePath
    self.range = range
  }
}

@MainActor public protocol EditorLanguageProvider: AnyObject {
  var completionTriggerCharacters: Set<Character> { get }
  func completions(at position: EditorPosition, trigger: Character?) async -> [EditorCompletionItem]
  func resolve(_ item: EditorCompletionItem) async -> EditorCompletionItem
  func hover(at position: EditorPosition) async -> EditorHover?
  func definition(at position: EditorPosition) async -> [EditorLocation]
}

/// What the editor asks the host app to do.
@MainActor public protocol EditorActions: AnyObject {
  func askAgentToFix(_ diagnostic: EditorDiagnostic)
  func sendSelectionToAgent(text: String, range: EditorRange)
  func revertHunk(_ mark: GutterMark)
  func open(_ location: EditorLocation)
  func completionAccepted()
}
