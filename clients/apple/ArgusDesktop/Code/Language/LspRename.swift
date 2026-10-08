import AppKit
import ArgusCore
import ArgusEditor
import Foundation

/// Rename Symbol: asks for the new name, gets the server's workspace edit and applies it. Open
/// files change in their buffers (unsaved, one undo step each); closed ones are read, edited and
/// written back against the hash they were read at, so a file an agent touched meanwhile is
/// left alone and reported.
@MainActor
enum LspRename {
  struct Outcome: Equatable {
    var buffers: [String] = []
    var written: [String] = []
    /// Files that changed on disk (or couldn't be read or written) and weren't renamed.
    var skipped: [String] = []
  }

  /// ⌃⌘E in the code view.
  static func run(in code: CodeSession, document: EditorDocument) async {
    guard let provider = document.languageProvider as? LspDocumentProvider, let store = code.store else {
      return NSSound.beep()
    }
    let caret = document.caret
    guard let name = ask(current: word(at: caret, in: document.text)) else { return }
    guard let edit = await provider.rename(at: caret, to: name), !edit.files.isEmpty else {
      return NSSound.beep()
    }
    if let outside = edit.files.first(where: { $0.relativePath.hasPrefix("/") }) {
      return alert("Rename would change a file outside this session: \((outside.relativePath as NSString).lastPathComponent). Nothing was changed.")
    }
    let outcome = await apply(edit, session: code.sessionId, sink: store) { code.files[$0]?.document }
    if !outcome.skipped.isEmpty {
      alert("These files changed on disk and weren't renamed: \(outcome.skipped.joined(separator: ", ")).")
    }
  }

  static func apply(
    _ edit: ArgusProtocol.LspWorkspaceEdit, session: String, sink: LspSink, openDocument: (String) -> EditorDocument?
  ) async -> Outcome {
    var outcome = Outcome()
    for file in edit.files {
      let edits = file.edits.map { (LspConvert.range($0.range), $0.newText) }
      if let document = openDocument(file.relativePath) {
        document.apply(edits: edits, moveCaret: false)
        outcome.buffers.append(file.relativePath)
        continue
      }
      do {
        let read = try await sink.send(
          ArgusProtocol.Commands.CodeReadFile.self, .init(id: session, relativePath: file.relativePath), session: session)
        guard read.readOnlyReason == nil else {
          outcome.skipped.append(file.relativePath)
          continue
        }
        let result = try await sink.send(
          ArgusProtocol.Commands.CodeWriteFile.self,
          .init(
            id: session, relativePath: file.relativePath, content: LspEdits.apply(file.edits, to: read.content),
            baseHash: read.hash, force: nil),
          session: session)
        if result.ok { outcome.written.append(file.relativePath) } else { outcome.skipped.append(file.relativePath) }
      } catch {
        outcome.skipped.append(file.relativePath)
      }
    }
    return outcome
  }

  /// The identifier around `position`, to prefill the prompt.
  static func word(at position: EditorPosition, in text: String) -> String {
    let lines = text.components(separatedBy: "\n")
    guard lines.indices.contains(position.line) else { return "" }
    let line = Array(lines[position.line].utf16)
    let isWord = { (unit: UInt16) in
      guard let scalar = Unicode.Scalar(unit) else { return false }
      return CharacterSet.alphanumerics.contains(scalar) || unit == 0x5F || unit == 0x24  // _ $
    }
    var start = min(position.utf16Column, line.count)
    var end = start
    while start > 0, isWord(line[start - 1]) { start -= 1 }
    while end < line.count, isWord(line[end]) { end += 1 }
    return String(utf16CodeUnits: Array(line[start..<end]), count: end - start)
  }

  private static func ask(current: String) -> String? {
    let alert = NSAlert()
    alert.messageText = "Rename Symbol"
    alert.informativeText = "Every reference the language server knows about is renamed. Open files change unsaved."
    let field = NSTextField(string: current)
    field.frame = NSRect(x: 0, y: 0, width: 260, height: 24)
    alert.accessoryView = field
    alert.window.initialFirstResponder = field
    alert.addButton(withTitle: "Rename")
    alert.addButton(withTitle: "Cancel")
    guard alert.runModal() == .alertFirstButtonReturn else { return nil }
    let name = field.stringValue.trimmingCharacters(in: .whitespaces)
    return name.isEmpty || name == current ? nil : name
  }

  private static func alert(_ message: String) {
    let alert = NSAlert()
    alert.messageText = "Rename Symbol"
    alert.informativeText = message
    alert.runModal()
  }
}

/// LSP text edits over a plain string; positions are UTF-16, ranges in the original text.
enum LspEdits {
  static func apply(_ edits: [ArgusProtocol.LspTextEdit], to text: String) -> String {
    let ns = NSMutableString(string: text)
    var lineStarts = [0]
    for index in 0..<ns.length where ns.character(at: index) == 0x0A { lineStarts.append(index + 1) }
    func offset(_ position: ArgusProtocol.LspPosition) -> Int {
      guard position.line < lineStarts.count else { return ns.length }
      let start = lineStarts[position.line]
      let end = position.line + 1 < lineStarts.count ? lineStarts[position.line + 1] - 1 : ns.length
      return min(start + max(0, position.character), end)
    }
    let resolved = edits.map { (start: offset($0.range.start), end: offset($0.range.end), text: $0.newText) }
    for edit in resolved.sorted(by: { $0.start > $1.start }) {
      ns.replaceCharacters(in: NSRange(location: edit.start, length: max(0, edit.end - edit.start)), with: edit.text)
    }
    return ns as String
  }
}
