import AppKit
import ArgusCore
import ArgusEditor
import Foundation

/// Find References (⇧⌃⌘F): the server's locations for the symbol at the
/// caret, shown in the navigator's Search mode with each line as its preview.
@MainActor
enum LspReferences {
  /// Lines are read for at most this many files; the rest show without a preview.
  static let previewFiles = 100

  static func run(in code: CodeSession, document: EditorDocument) async {
    guard let provider = document.languageProvider as? LspDocumentProvider else { return NSSound.beep() }
    let caret = document.caret
    let name = LspRename.word(at: caret, in: document.text)
    guard let locations = await provider.references(at: caret), !locations.isEmpty else { return NSSound.beep() }
    let matches = await self.matches(for: locations) { path in
      if let open = code.files[path]?.document { return open.text }
      return await code.readText(path)
    }
    code.search.show(matches, title: name)
    code.navigatorVisible = true
    code.navigatorMode = .search
  }

  /// Locations inside the worktree as search matches, in path and line order.
  static func matches(
    for locations: [ArgusProtocol.LspLocation], text: (String) async -> String?
  ) async -> [ArgusProtocol.CodeSearchMatch] {
    let inside = locations.filter { !$0.relativePath.hasPrefix("/") }
    let byPath = Dictionary(grouping: inside, by: \.relativePath)
    var matches: [ArgusProtocol.CodeSearchMatch] = []
    for (index, path) in byPath.keys.sorted().enumerated() {
      let lines = index < previewFiles ? (await text(path))?.components(separatedBy: "\n") : nil
      let sorted = (byPath[path] ?? []).sorted {
        ($0.range.start.line, $0.range.start.character) < ($1.range.start.line, $1.range.start.character)
      }
      for location in sorted {
        let start = location.range.start
        let end = location.range.end
        var line = lines.flatMap { $0.indices.contains(start.line) ? $0[start.line] : nil } ?? ""
        if line.hasSuffix("\r") { line.removeLast() }
        matches.append(
          .init(
            relativePath: path, line: start.line + 1, column: start.character,
            length: end.line == start.line ? max(0, end.character - start.character) : 0,
            preview: String(line.prefix(240)), previewOffset: 0))
      }
    }
    return matches
  }
}
