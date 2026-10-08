import ArgusCore
import ArgusEditor
import Foundation
import Testing

@testable import Argus

@MainActor
struct LspEditTests {
  private let edit = try! JSONDecoder().decode(
    ArgusProtocol.LspWorkspaceEdit.self,
    from: Data(
      #"""
      {"files":[
        {"relativePath":"a.ts","edits":[{"range":{"start":{"line":0,"character":4},"end":{"line":0,"character":7}},"newText":"bar"}]},
        {"relativePath":"b.ts","edits":[{"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":3}},"newText":"bar"}]}
      ]}
      """#.utf8))

  @Test func renameEditsBuffersAndWritesClosedFilesAgainstTheirHash() async throws {
    let sink = FakeSink()
    sink.responses["code_read_file"] = #"{"content":"foo()\n","hash":"h1","size":6,"mtimeMs":0,"eol":"lf"}"#
    sink.responses["code_write_file"] = #"{"ok":true,"hash":"h2"}"#
    let open = EditorDocument(text: "let foo = 1\n", language: .typescript, configuration: .default)
    let outcome = await LspRename.apply(edit, session: "s1", sink: sink) { $0 == "a.ts" ? open : nil }
    #expect(outcome == LspRename.Outcome(buffers: ["a.ts"], written: ["b.ts"], skipped: []))
    #expect(open.text == "let bar = 1\n")
    #expect(open.isDirty)
    let write = try #require(sink.params("code_write_file", as: ArgusProtocol.CommandsTypes.CodeWriteFileParams.self).first)
    #expect(write.content == "bar()\n")
    #expect(write.baseHash == "h1")
  }

  @Test func aConflictLeavesTheFileAlone() async {
    let sink = FakeSink()
    sink.responses["code_read_file"] = #"{"content":"foo()\n","hash":"h1","size":6,"mtimeMs":0,"eol":"lf"}"#
    sink.responses["code_write_file"] = #"{"ok":false,"conflict":{"hash":"h9"}}"#
    let outcome = await LspRename.apply(edit, session: "s1", sink: sink) { _ in nil }
    #expect(outcome.skipped == ["a.ts", "b.ts"])
    #expect(outcome.written.isEmpty)
  }

  @Test func textEditsApplyInOriginalCoordinates() {
    let edits: [ArgusProtocol.LspTextEdit] = [
      .init(range: .init(start: .init(line: 0, character: 0), end: .init(line: 0, character: 1)), newText: "AA"),
      .init(range: .init(start: .init(line: 1, character: 2), end: .init(line: 1, character: 2)), newText: "!"),
    ]
    #expect(LspEdits.apply(edits, to: "a b\nc d\n") == "AA b\nc !d\n")
  }

  @Test func renamePrefillsTheWordAtTheCaret() {
    #expect(LspRename.word(at: EditorPosition(line: 0, utf16Column: 6), in: "let fooBar = 1") == "fooBar")
    #expect(LspRename.word(at: EditorPosition(line: 3, utf16Column: 0), in: "x") == "")
  }
}
