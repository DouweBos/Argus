import ArgusCore
import ArgusEditor
import Foundation
import Testing

@testable import Argus

@MainActor
struct CodeFormattingTests {
  private func formatting(_ sink: FakeSink, mode: FormatOnSave, server: @escaping () -> Bool = { false })
    -> (CodeFormatting, () -> Int)
  {
    var serverCalls = 0
    let formatting = CodeFormatting(sink: sink, mode: { mode }) { _, _, _ in
      serverCalls += 1
      return server()
    }
    return (formatting, { serverCalls })
  }

  @Test func appliesTheProjectFormattersOutputAsLineEdits() async {
    let sink = FakeSink()
    sink.responses["code_format"] = #"{"formatter":"prettier","formatted":"const a = 1;\nconst b = 2;\n"}"#
    let document = EditorDocument(text: "const a  =  1\nconst b = 2;\n", language: .typescript, configuration: .default)
    let (formatting, serverCalls) = formatting(sink, mode: .automatic)
    let outcome = await formatting.format(session: "s1", path: "a.ts", document: document, trigger: .save)
    #expect(document.text == "const a = 1;\nconst b = 2;\n")
    #expect(outcome == CodeFormatOutcome(formatter: .prettier, changed: true, status: .init(formatter: .prettier)))
    #expect(serverCalls() == 0)
    let sent = sink.params("code_format", as: ArgusProtocol.CommandsTypes.CodeFormatParams.self)
    #expect(sent.first?.content == "const a  =  1\nconst b = 2;\n")
  }

  @Test func aFailureKeepsTheTextAndSaysWhy() async {
    let sink = FakeSink()
    sink.responses["code_format"] = #"{"formatter":"prettier","formatted":null,"error":"SyntaxError: ';' expected"}"#
    let document = EditorDocument(text: "const = ;\n", language: .typescript, configuration: .default)
    let (formatting, serverCalls) = formatting(sink, mode: .always, server: { true })
    let outcome = await formatting.format(session: "s1", path: "a.ts", document: document, trigger: .save)
    #expect(document.text == "const = ;\n")
    #expect(outcome.status?.error == "SyntaxError: ';' expected")
    #expect(!outcome.changed)
    #expect(serverCalls() == 0, "the project's formatter owns the file; the server doesn't second-guess it")
  }

  @Test func automaticLeavesFilesWithoutAProjectFormatterAlone() async {
    let sink = FakeSink()
    sink.responses["code_format"] = #"{"formatter":"none","formatted":null}"#
    let document = EditorDocument(text: "x", language: .typescript, configuration: .default)
    let (automatic, automaticServer) = formatting(sink, mode: .automatic, server: { true })
    #expect(await automatic.format(session: "s1", path: "a.ts", document: document, trigger: .save) == CodeFormatOutcome())
    #expect(automaticServer() == 0)
    let (always, _) = formatting(sink, mode: .always, server: { true })
    #expect(await always.format(session: "s1", path: "a.ts", document: document, trigger: .save).formatter == .lsp)
    let command = await automatic.format(session: "s1", path: "a.ts", document: document, trigger: .command)
    #expect(command.formatter == .lsp, "Format Document always tries the server")
  }

  @Test func neverSkipsSavesButNotFormatDocument() async {
    let sink = FakeSink()
    sink.responses["code_format"] = #"{"formatter":"swift-format","formatted":"let a = 1\n"}"#
    let document = EditorDocument(text: "let  a=1\n", language: .swift, configuration: .default)
    let (formatting, _) = formatting(sink, mode: .never)
    #expect(await formatting.format(session: "s1", path: "A.swift", document: document, trigger: .save) == CodeFormatOutcome())
    #expect(sink.calls.isEmpty)
    let outcome = await formatting.format(session: "s1", path: "A.swift", document: document, trigger: .command)
    #expect(outcome.formatter == .swiftFormat)
    #expect(document.text == "let a = 1\n")
  }

  @Test(arguments: [
    ("a\nb\nc\n", "a\nB\nc\n"),
    ("a\nb\n", "a\nb\nc\n"),
    ("a\nb\nc", "b\nc\n"),
    ("", "x\n"),
    ("one\r\ntwo\r\n", "one\ntwo\n"),
    ("x\ny\nz\n", ""),
  ])
  func diffEditsRebuildTheFormattedText(old: String, new: String) {
    let text = NSMutableString(string: old)
    for (range, replacement) in FormatDiff.edits(from: old, to: new).reversed() {
      text.replaceCharacters(in: range, with: replacement)
    }
    #expect(text as String == new)
  }

  @Test func diffLeavesUnchangedLinesOutOfTheEdits() {
    let edits = FormatDiff.edits(from: "a\nb\nc\nd\n", to: "a\nB\nc\nD\n")
    #expect(edits.map(\.0) == [NSRange(location: 2, length: 2), NSRange(location: 6, length: 2)])
    #expect(edits.map(\.1) == ["B\n", "D\n"])
  }
}

@MainActor
struct FormatOnSaveSettingTests {
  private func defaults() -> UserDefaults {
    let name = "argus-tests-\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: name)!
    defaults.removePersistentDomain(forName: name)
    return defaults
  }

  @Test func defaultsToAutomatic() {
    #expect(AppPreferences.formatOnSave(in: defaults()) == .automatic)
  }

  @Test func migratesTheOldToggle() {
    let on = defaults()
    on.set(true, forKey: "argus:editor.formatOnSave")
    #expect(AppPreferences.formatOnSave(in: on) == .always)
    let off = defaults()
    off.set(false, forKey: "argus:editor.formatOnSave")
    #expect(AppPreferences.formatOnSave(in: off) == .automatic)
  }

  @Test func theTriStateWinsAndPersists() {
    let store = defaults()
    store.set(true, forKey: "argus:editor.formatOnSave")
    let preferences = AppPreferences(defaults: store)
    preferences.editorFormatOnSave = .never
    #expect(AppPreferences(defaults: store).editorFormatOnSave == .never)
  }
}
