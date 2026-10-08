import ArgusSyntax
import ArgusUI
import SwiftUI

#if DEBUG
  @MainActor enum EditorPreviewSample {
    static let swift = """
      import Foundation

      /// Loads a session's files and keeps them fresh.
      struct FileIndex {
        var paths: [String] = []
        let limit = 20_000

        mutating func refresh(from root: URL) throws {
          let items = try FileManager.default.contentsOfDirectory(atPath: root.path)
          paths = items.filter { !$0.hasPrefix(".") }.sorted()
          if paths.count > limit { paths.removeLast(paths.count - limit) }
        }
      }

      """

    static func document() -> EditorDocument {
      let document = EditorDocument(text: swift, language: .swift, configuration: .default)
      document.gitMarks = [
        GutterMark(kind: .modified, lines: 9..<10, baseLines: ["      paths = items.sorted()"]),
        GutterMark(kind: .added, lines: 10..<11),
        GutterMark(kind: .deleted, lines: 5..<5, baseLines: ["  var updatedAt: Date?"]),
      ]
      document.diagnostics = [
        EditorDiagnostic(
          range: EditorRange(start: .init(line: 5, utf16Column: 6), end: .init(line: 5, utf16Column: 11)),
          severity: .warning, message: "Immutable value 'limit' could be static", source: "sourcekit")
      ]
      return document
    }
  }

  #Preview("Swift file") {
    CodeEditorView(document: EditorPreviewSample.document())
      .environment(\.theme, .dark)
      .frame(width: 760, height: 420)
  }
#endif
