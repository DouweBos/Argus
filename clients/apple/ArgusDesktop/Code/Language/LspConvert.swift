import ArgusCore
import ArgusEditor
import Foundation

/// Between the editor's model and the host's LSP shapes. Both count UTF-16 from 0, so
/// positions map one to one.
enum LspConvert {
  static func position(_ position: EditorPosition) -> ArgusProtocol.LspPosition {
    .init(line: position.line, character: position.utf16Column)
  }

  static func position(_ position: ArgusProtocol.LspPosition) -> EditorPosition {
    EditorPosition(line: position.line, utf16Column: position.character)
  }

  static func range(_ range: EditorRange) -> ArgusProtocol.LspRange {
    .init(start: position(range.start), end: position(range.end))
  }

  static func range(_ range: ArgusProtocol.LspRange) -> EditorRange {
    EditorRange(start: position(range.start), end: position(range.end))
  }

  /// An edit as `lsp_did_change` takes it; a whole-document replace goes without a range.
  static func contentChange(_ change: EditorTextChange) -> ArgusProtocol.LspContentChange {
    .init(range: change.isFullReplace ? nil : range(change.range), text: change.text)
  }

  static func edit(_ edit: ArgusProtocol.LspTextEdit) -> EditorTextEdit {
    EditorTextEdit(range: range(edit.range), text: edit.newText)
  }

  // MARK: Completion

  /// `opaque` carries the host's `resolveId`.
  static func completionItem(_ item: ArgusProtocol.LspCompletionItem) -> EditorCompletionItem {
    let raw = item.textEdit?.newText ?? item.insertText ?? item.label
    let text = item.insertTextFormat == .snippet ? plainText(fromSnippet: raw) : raw
    let kind = item.kind.flatMap(completionKind) ?? .text
    return EditorCompletionItem(
      id: item.resolveId, label: item.label, detail: item.detail, documentation: item.documentation,
      // The editor strips snippet syntax from `.snippet` items itself; `text` is already plain.
      kind: kind, insertText: text, replaceRange: item.textEdit.map { range($0.range) },
      sortText: item.preselect == true ? " " + (item.sortText ?? item.label) : item.sortText,
      filterText: item.filterText, opaque: item.resolveId,
      additionalEdits: (item.additionalTextEdits ?? []).map(edit))
  }

  /// A resolved item keeps the list's id, range and text; it adds documentation and imports.
  static func merge(_ resolved: ArgusProtocol.LspCompletionItem, into item: EditorCompletionItem) -> EditorCompletionItem {
    var merged = item
    merged.detail = resolved.detail ?? item.detail
    merged.documentation = resolved.documentation ?? item.documentation
    if let extra = resolved.additionalTextEdits, !extra.isEmpty { merged.additionalEdits = extra.map(edit) }
    return merged
  }

  static func completionKind(_ kind: ArgusProtocol.LspCompletionKind) -> EditorCompletionKind? {
    switch kind {
    case .enumMember: .enumMember
    case .typeParameter: .typeParameter
    default: EditorCompletionKind(rawValue: kind.rawValue)
    }
  }

  /// LSP snippet syntax as plain text: placeholders keep their default, choices their first
  /// option, tab stops and variables vanish, escapes are undone.
  static func plainText(fromSnippet snippet: String) -> String {
    var output = ""
    var characters = Array(snippet)[...]
    plain(&characters, into: &output, closing: nil)
    return output
  }

  private static func plain(_ input: inout ArraySlice<Character>, into output: inout String, closing: Character?) {
    while let character = input.first {
      if character == closing { return }
      input.removeFirst()
      if character == "\\", let next = input.first, "$}\\,|".contains(next) {
        output.append(next)
        input.removeFirst()
      } else if character == "$", let next = input.first {
        if next == "{" {
          input.removeFirst()
          placeholder(&input, into: &output)
        } else if next.isNumber || next.isLetter || next == "_" {
          while let c = input.first, c.isNumber || c.isLetter || c == "_" { input.removeFirst() }
        } else {
          output.append(character)
        }
      } else {
        output.append(character)
      }
    }
  }

  /// After `${`: `1}`, `1:default}`, `1|a,b|}` or `NAME:default}`.
  private static func placeholder(_ input: inout ArraySlice<Character>, into output: inout String) {
    while let c = input.first, c.isNumber || c.isLetter || c == "_" { input.removeFirst() }
    switch input.first {
    case ":":
      input.removeFirst()
      plain(&input, into: &output, closing: "}")
    case "|":
      input.removeFirst()
      var choice = ""
      while let c = input.first, c != "|" {
        input.removeFirst()
        choice.append(c)
      }
      output += choice.split(separator: ",", omittingEmptySubsequences: false).first.map(String.init) ?? ""
      if input.first == "|" { input.removeFirst() }
    default: break
    }
    if input.first == "}" { input.removeFirst() }
  }

  // MARK: Diagnostics

  static func severity(_ severity: ArgusProtocol.LspDiagnosticSeverity) -> DiagnosticSeverity {
    switch severity {
    case .error: .error
    case .warning: .warning
    case .hint: .hint
    default: .info
    }
  }

  /// Ids are stable across identical publishes, so lists don't churn.
  static func diagnostics(_ diagnostics: [ArgusProtocol.LspDiagnostic]) -> [EditorDiagnostic] {
    diagnostics.enumerated().map { index, diagnostic in
      let range = range(diagnostic.range)
      return EditorDiagnostic(
        id: "\(index):\(range.start.line):\(range.start.utf16Column):\(diagnostic.message.hashValue)", range: range,
        severity: severity(diagnostic.severity), message: diagnostic.message, source: diagnostic.source,
        code: diagnostic.code)
    }
  }

  static func hover(_ hover: ArgusProtocol.LspHover) -> EditorHover? {
    let markdown = hover.contents.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !markdown.isEmpty else { return nil }
    return EditorHover(markdown: markdown, range: hover.range.map(range))
  }

  static func location(_ location: ArgusProtocol.LspLocation) -> EditorLocation {
    EditorLocation(relativePath: location.relativePath, range: range(location.range))
  }
}
