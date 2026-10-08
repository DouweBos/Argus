import ArgusCore
import ArgusEditor
import ArgusSyntax
import Foundation
import Testing

@testable import Argus

/// Records every request; `hold` parks them until `release()`.
@MainActor
final class FakeSink: LspSink {
  var calls: [(name: String, params: Any)] = []
  var subscriptions: [(scope: String, on: Bool)] = []
  var responses: [String: String] = [:]
  var hold = false
  private var held: [CheckedContinuation<Void, Never>] = []

  /// Document traffic and requests; status refreshes left out.
  var names: [String] { calls.map(\.name).filter { $0 != "lsp_status" } }

  func send<C: RemoteCommand>(_ command: C.Type, _ params: C.Params, session: String) async throws -> C.Result {
    calls.append((C.name, params))
    if hold { await withCheckedContinuation { held.append($0) } }
    return try JSONDecoder().decode(C.Result.self, from: Data((responses[C.name] ?? "null").utf8))
  }

  func subscribe(_ scope: String, session: String, on: Bool) async {
    subscriptions.append((scope, on))
  }

  func report(_ error: Error, scope: String) {}

  func release() {
    hold = false
    let parked = held
    held = []
    parked.forEach { $0.resume() }
  }

  func params<P>(_ name: String, as _: P.Type) -> [P] {
    calls.filter { $0.name == name }.compactMap { $0.params as? P }
  }
}

/// Lets queued tasks run until `condition` holds.
@MainActor
func settle(_ condition: () -> Bool = { false }) async {
  for _ in 0..<200 where !condition() { await Task.yield() }
}

@MainActor
struct LanguageClientTests {
  private typealias Change = ArgusProtocol.CommandsTypes.LspDidChangeParams
  private typealias Open = ArgusProtocol.CommandsTypes.LspDidOpenParams

  private func edit(_ line: Int, _ column: Int, _ text: String, version: Int) -> EditorTextChange {
    EditorTextChange(range: EditorRange(EditorPosition(line: line, utf16Column: column)), text: text, version: version)
  }

  @Test func changesConvert() {
    let incremental = LspConvert.contentChange(edit(2, 4, "x", version: 1))
    #expect(incremental.range?.start.line == 2)
    #expect(incremental.range?.start.character == 4)
    let full = LspConvert.contentChange(
      EditorTextChange(range: EditorRange(EditorPosition(line: 0, utf16Column: 0)), text: "all", version: 2, isFullReplace: true))
    #expect(full.range == nil)
    #expect(full.text == "all")
  }

  @Test func changesGoOutInOrderAndCoalesce() async throws {
    let sink = FakeSink()
    let client = LanguageClient(sessionId: "s1", sink: sink) { _ in true }
    let document = EditorDocument(text: "let a = 1\n", language: .typescript, configuration: .default)
    sink.hold = true
    client.opened(path: "a.ts", document: document, language: .typescript)
    await settle { sink.names == ["lsp_did_open"] }
    #expect(sink.subscriptions.first?.scope == "lsp:s1")
    client.changed(path: "a.ts", change: edit(0, 0, "x", version: 1))
    client.changed(path: "a.ts", change: edit(0, 1, "y", version: 2))
    client.changed(path: "a.ts", change: edit(0, 2, "z", version: 3))
    #expect(sink.names == ["lsp_did_open"], "nothing overtakes the open")
    sink.release()
    let provider = try #require(document.languageProvider as? LspDocumentProvider)
    await provider.sync.flush()
    #expect(sink.names == ["lsp_did_open", "lsp_did_change"])
    let change = try #require(sink.params("lsp_did_change", as: Change.self).first)
    #expect(change.version == 3)
    #expect(change.changes.map(\.text) == ["x", "y", "z"])
  }

  @Test func fullReplaceSupersedesQueuedEdits() async throws {
    let sink = FakeSink()
    let client = LanguageClient(sessionId: "s1", sink: sink) { _ in true }
    let document = EditorDocument(text: "a", language: .typescript, configuration: .default)
    sink.hold = true
    client.opened(path: "a.ts", document: document, language: .typescript)
    await settle { !sink.names.isEmpty }
    client.changed(path: "a.ts", change: edit(0, 0, "x", version: 1))
    client.changed(
      path: "a.ts",
      change: EditorTextChange(range: EditorRange(EditorPosition(line: 0, utf16Column: 0)), text: "new", version: 2, isFullReplace: true))
    sink.release()
    await (document.languageProvider as! LspDocumentProvider).sync.flush()
    let change = try #require(sink.params("lsp_did_change", as: Change.self).first)
    #expect(change.changes.count == 1)
    #expect(change.changes.first?.range == nil)
  }

  @Test func requestsWaitForPendingChanges() async {
    let sink = FakeSink()
    sink.responses["lsp_completion"] = #"{"isIncomplete":false,"items":[{"resolveId":"r1","label":"log"}]}"#
    let client = LanguageClient(sessionId: "s1", sink: sink) { _ in true }
    let document = EditorDocument(text: "console", language: .typescript, configuration: .default)
    sink.hold = true
    client.opened(path: "a.ts", document: document, language: .typescript)
    await settle { !sink.names.isEmpty }
    client.changed(path: "a.ts", change: edit(0, 7, ".", version: 1))
    let provider = document.languageProvider!
    let request = Task { await provider.completions(at: EditorPosition(line: 0, utf16Column: 8), trigger: ".") }
    await settle()
    #expect(sink.names == ["lsp_did_open"])
    sink.release()
    let items = await request.value
    #expect(sink.names == ["lsp_did_open", "lsp_did_change", "lsp_completion"])
    #expect(items.map(\.label) == ["log"])
  }

  @Test func staleAnswersAreDropped() async {
    let sink = FakeSink()
    sink.responses["lsp_hover"] = #"{"contents":"**x**"}"#
    let client = LanguageClient(sessionId: "s1", sink: sink) { _ in true }
    let document = EditorDocument(text: "x", language: .typescript, configuration: .default)
    client.opened(path: "a.ts", document: document, language: .typescript)
    let provider = document.languageProvider!
    #expect(await provider.hover(at: EditorPosition(line: 0, utf16Column: 0))?.markdown == "**x**")
    sink.hold = true
    let request = Task { await provider.hover(at: EditorPosition(line: 0, utf16Column: 0)) }
    await settle { sink.names.last == "lsp_hover" && sink.names.count > 2 }
    document.apply(edits: [(EditorRange(EditorPosition(line: 0, utf16Column: 1)), "y")])
    sink.release()
    #expect(await request.value == nil)
  }

  @Test func diagnosticsOlderThanTheBufferAreIgnored() async {
    let sink = FakeSink()
    let client = LanguageClient(sessionId: "s1", sink: sink) { _ in true }
    let document = EditorDocument(text: "let a\n", language: .typescript, configuration: .default)
    client.opened(path: "a.ts", document: document, language: .typescript)
    document.apply(edits: [(EditorRange(EditorPosition(line: 0, utf16Column: 5)), " = 1")])
    #expect(document.version == 1)
    let diagnostic = ArgusProtocol.LspDiagnostic(
      range: .init(start: .init(line: 0, character: 4), end: .init(line: 0, character: 5)), severity: .error,
      message: "boom", source: "ts", code: "2304")
    client.receive(ArgusProtocol.LspDiagnosticsEvent(relativePath: "a.ts", version: 0, diagnostics: [diagnostic]))
    #expect(document.diagnostics.isEmpty)
    client.receive(ArgusProtocol.LspDiagnosticsEvent(relativePath: "a.ts", version: 1, diagnostics: [diagnostic]))
    #expect(document.diagnostics.map(\.message) == ["boom"])
    #expect(document.diagnostics.first?.severity == .error)
    client.receive(ArgusProtocol.LspDiagnosticsEvent(relativePath: "a.ts", version: nil, diagnostics: []))
    #expect(document.diagnostics.isEmpty)
    client.receive(ArgusProtocol.LspDiagnosticsEvent(relativePath: "other.ts", version: nil, diagnostics: [diagnostic]))
    #expect(document.diagnostics.isEmpty)
  }

  @Test func disablingClosesAndEnablingReopens() async {
    let sink = FakeSink()
    var enabled = true
    let client = LanguageClient(sessionId: "s1", sink: sink) { _ in enabled }
    let document = EditorDocument(text: "x", language: .swift, configuration: .default)
    client.opened(path: "A.swift", document: document, language: .swift)
    await settle { sink.names.count == 1 }
    document.diagnostics = [EditorDiagnostic(range: EditorRange(EditorPosition(line: 0, utf16Column: 0)), severity: .warning, message: "w")]
    enabled = false
    client.settingsChanged()
    #expect(document.languageProvider == nil)
    #expect(document.diagnostics.isEmpty)
    #expect(client.language(of: "A.swift") == nil)
    await settle { sink.names.count == 2 }
    enabled = true
    client.settingsChanged()
    await settle { sink.names.count == 3 }
    #expect(sink.names == ["lsp_did_open", "lsp_did_close", "lsp_did_open"])
    #expect(sink.params("lsp_did_open", as: Open.self).map(\.languageId) == ["swift", "swift"])
    #expect(sink.subscriptions.map(\.on) == [true, false, true])
    client.closed(path: "A.swift")
    await settle { sink.names.count == 4 }
    #expect(sink.names.last == "lsp_did_close")
  }

  @Test func formatOnSaveAppliesTheServersEdits() async throws {
    let sink = FakeSink()
    sink.responses["lsp_format"] =
      #"[{"range":{"start":{"line":0,"character":5},"end":{"line":0,"character":5}},"newText":" "}]"#
    let support = LanguageSupport(sink: sink, isEnabled: { _ in true }, formatOnSave: { true })
    let document = EditorDocument(text: "let a=1", language: .typescript, configuration: .default)
    support.documentOpened(session: "s1", path: "a.ts", document: document, language: .typescript)
    #expect(await !support.willSave(session: "s1", path: "a.ts", document: document), "not before the server is up")
    support.client("s1").receive(ArgusProtocol.LspStatus(servers: [.init(language: .typescript, state: .ready)]))
    #expect(await support.willSave(session: "s1", path: "a.ts", document: document))
    #expect(document.text == "let a =1")
    let format = try #require(sink.params("lsp_format", as: ArgusProtocol.CommandsTypes.LspFormatParams.self).first)
    #expect(format.tabSize == 4)
    #expect(format.insertSpaces)
  }

  @Test func filesWithoutAServerStayLocal() {
    let sink = FakeSink()
    let client = LanguageClient(sessionId: "s1", sink: sink) { _ in true }
    let document = EditorDocument(text: "# hi", language: .markdown, configuration: .default)
    client.opened(path: "README.md", document: document, language: .markdown)
    #expect(document.languageProvider == nil)
    #expect(sink.subscriptions.isEmpty)
  }
}

struct LspConvertTests {
  @Test func completionItemsMapRangesSnippetsAndImports() throws {
    let json = #"""
      {"resolveId":"r7","label":"useState","kind":"function","detail":"react",
       "insertTextFormat":"snippet",
       "textEdit":{"range":{"start":{"line":3,"character":2},"end":{"line":3,"character":5}},"newText":"useState(${1:initial})$0"},
       "additionalTextEdits":[{"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}},"newText":"import { useState } from \"react\";\n"}],
       "sortText":"1","filterText":"useState"}
      """#
    let item = try JSONDecoder().decode(ArgusProtocol.LspCompletionItem.self, from: Data(json.utf8))
    let mapped = LspConvert.completionItem(item)
    #expect(mapped.id == "r7")
    #expect(mapped.opaque as? String == "r7")
    #expect(mapped.kind == .function)
    #expect(mapped.insertText == "useState(initial)")
    #expect(mapped.replaceRange == EditorRange(start: .init(line: 3, utf16Column: 2), end: .init(line: 3, utf16Column: 5)))
    #expect(mapped.additionalEdits.map(\.text) == ["import { useState } from \"react\";\n"])
    #expect(mapped.sortText == "1")
  }

  @Test func plainItemsFallBackToTheLabel() throws {
    let item = try JSONDecoder().decode(
      ArgusProtocol.LspCompletionItem.self, from: Data(#"{"resolveId":"r","label":"length","kind":"enum_member","preselect":true}"#.utf8))
    let mapped = LspConvert.completionItem(item)
    #expect(mapped.insertText == "length")
    #expect(mapped.replaceRange == nil)
    #expect(mapped.kind == .enumMember)
    #expect(mapped.sortText == " length")
  }

  @Test(arguments: [
    ("foo(${1:a}, ${2|x,y|})$0", "foo(a, x)"),
    ("${1:outer ${2:inner}}", "outer inner"),
    ("cost: \\$5 $TM_FILENAME", "cost: $5 "),
    ("plain", "plain"),
  ])
  func snippetsBecomePlainText(snippet: String, plain: String) {
    #expect(LspConvert.plainText(fromSnippet: snippet) == plain)
  }

  @Test func languagesMapByExtension() {
    #expect(LspLanguageMap.resolve(path: "App.tsx", language: .tsx)?.languageId == "typescriptreact")
    #expect(LspLanguageMap.resolve(path: "App.jsx", language: .javascript)?.languageId == "javascriptreact")
    #expect(LspLanguageMap.resolve(path: "View.h", language: .objc)?.languageId == "objective-c")
    #expect(LspLanguageMap.resolve(path: "View.mm", language: .objc)?.languageId == "objective-cpp")
    let c = LspLanguageMap.resolve(path: "main.c", language: nil)
    #expect(c?.server == .c)
    #expect(c?.settingsKey == "objc")
    #expect(LspLanguageMap.resolve(path: "App.tsx", language: .tsx)?.settingsKey == "typescript")
    #expect(LspLanguageMap.resolve(path: "README.md", language: .markdown) == nil)
    #expect(LspLanguageMap.resolve(path: "run", language: .python)?.languageId == "python")
    #expect(LspLanguageMap.resolve(path: "build.sh", language: .bash) == nil)
  }
}
