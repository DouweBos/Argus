import ArgusCore
import ArgusEditor
import Foundation

/// A file's formatter as the status bar shows it, and how its last run went.
struct CodeFormatStatus: Equatable {
  var formatter: ArgusProtocol.CodeFormatter
  /// The last run's complaint (a syntax error, not installed, too slow); cleared by the next good run.
  var error: String?

  var name: String { Self.name(formatter) }

  static func name(_ formatter: ArgusProtocol.CodeFormatter) -> String {
    switch formatter {
    case .prettier: "Prettier"
    case .swiftformat: "SwiftFormat"
    case .swiftFormat: "swift-format"
    case .gofmt: "gofmt"
    case .ruff: "Ruff"
    case .black: "Black"
    default: formatter.rawValue
    }
  }
}

/// What one format did.
struct CodeFormatOutcome: Equatable {
  var formatter: MacTelemetryEvent.EditorFormatter = .none
  var changed = false
  /// The project formatter's state, when the project has one for the file.
  var status: CodeFormatStatus?
}

/// Format Document and format on save: the project's own formatter through `code_format`,
/// else the language server's. Never holds a save: a failure leaves the text as it was.
@MainActor
final class CodeFormatting {
  enum Trigger { case save, command }

  private weak var sink: LspSink?
  private let languageServer: @MainActor (String, String, EditorDocument) async -> Bool
  private let mode: @MainActor () -> FormatOnSave

  init(
    sink: LspSink, mode: @escaping @MainActor () -> FormatOnSave,
    languageServer: @escaping @MainActor (_ session: String, _ path: String, EditorDocument) async -> Bool
  ) {
    self.sink = sink
    self.mode = mode
    self.languageServer = languageServer
  }

  /// Which project formatter covers `path`, without running it.
  func detect(session: String, path: String) async -> CodeFormatStatus? {
    guard
      let result = try? await sink?.send(
        ArgusProtocol.Commands.CodeFormat.self, .init(id: session, relativePath: path), session: session)
    else { return nil }
    return CodeFormatStatus(formatter: result.formatter, error: result.error)
  }

  func format(session: String, path: String, document: EditorDocument, trigger: Trigger) async -> CodeFormatOutcome {
    let mode = trigger == .save ? mode() : .always
    guard mode != .never, document.isEditable else { return CodeFormatOutcome() }
    let version = document.version
    let text = document.text
    let result = try? await sink?.send(
      ArgusProtocol.Commands.CodeFormat.self, .init(id: session, relativePath: path, content: text), session: session)
    if let result, result.formatter != .none {
      let status = CodeFormatStatus(formatter: result.formatter, error: result.error)
      var outcome = CodeFormatOutcome(formatter: Self.telemetryName(result.formatter), status: status)
      // Typing while it ran: this text is stale, keep the user's.
      if let formatted = result.formatted, document.version == version {
        let edits = FormatDiff.edits(from: text, to: formatted).map { range, replacement in
          (EditorRange(start: document.position(of: range.location), end: document.position(of: NSMaxRange(range))), replacement)
        }
        document.apply(edits: edits, moveCaret: false)
        outcome.changed = !edits.isEmpty
      }
      return outcome
    }
    guard mode == .always, await languageServer(session, path, document) else { return CodeFormatOutcome() }
    return CodeFormatOutcome(formatter: .lsp, changed: true)
  }

  static func telemetryName(_ formatter: ArgusProtocol.CodeFormatter) -> MacTelemetryEvent.EditorFormatter {
    switch formatter {
    case .prettier: .prettier
    case .swiftformat: .swiftformat
    case .swiftFormat: .swiftFormat
    case .none: .none
    default: .other
    }
  }
}

/// The formatter's output as line hunks against the buffer, so carets outside a changed hunk
/// keep their place and undo is one step.
enum FormatDiff {
  /// UTF-16 ranges in `old`, each with its replacement.
  static func edits(from old: String, to new: String) -> [(NSRange, String)] {
    guard old != new else { return [] }
    let oldLines = lines(old)
    let newLines = lines(new)
    var removed = Set<Int>()
    var inserted = Set<Int>()
    for change in newLines.difference(from: oldLines) {
      switch change {
      case .remove(let offset, _, _): removed.insert(offset)
      case .insert(let offset, _, _): inserted.insert(offset)
      }
    }
    var starts = [0]
    for line in oldLines { starts.append(starts.last! + (line as NSString).length) }
    var edits: [(NSRange, String)] = []
    let (n, m) = (oldLines.count, newLines.count)
    var i = 0
    var j = 0
    while i < n || j < m {
      if i < n, j < m, !removed.contains(i), !inserted.contains(j) {
        i += 1
        j += 1
        continue
      }
      let (oldStart, newStart) = (i, j)
      while (i < n && removed.contains(i)) || (j < m && inserted.contains(j)) {
        if i < n, removed.contains(i) { i += 1 }
        if j < m, inserted.contains(j) { j += 1 }
      }
      // Unmatched lines the diff didn't name can't happen; if they do, take the rest whole.
      if (i, j) == (oldStart, newStart) { (i, j) = (n, m) }
      edits.append((NSRange(location: starts[oldStart], length: starts[i] - starts[oldStart]), newLines[newStart..<j].joined()))
    }
    return edits
  }

  /// Lines with their terminators, so joining them gives the text back.
  static func lines(_ text: String) -> [String] {
    var result: [String] = []
    var current = ""
    for character in text {
      current.append(character)
      if character == "\n" || character == "\r\n" || character == "\r" {
        result.append(current)
        current = ""
      }
    }
    if !current.isEmpty { result.append(current) }
    return result
  }
}
