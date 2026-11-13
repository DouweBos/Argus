import Foundation
import Testing

@testable import ArgusUI

@Suite("DictationDraft")
struct DictationDraftTests {
  @Test("words land at the caret, spaced from both sides")
  func splices() {
    let draft = DictationDraft(text: "fix thebuild", caret: 7)
    let merged = draft.merged("the flaky")
    #expect(merged.text == "fix the the flaky build")
    #expect(merged.caret == "fix the the flaky".utf16.count)
  }

  @Test("no extra space beside existing whitespace or an empty draft")
  func spacing() {
    #expect(DictationDraft(text: "", caret: 0).merged(" hello ").text == "hello")
    #expect(DictationDraft(text: "fix ", caret: 4).merged("it").text == "fix it")
    #expect(DictationDraft(text: "a\nb", caret: 2).merged("x").text == "a\nx b")
  }

  @Test("silence leaves the draft as it was")
  func empty() {
    let draft = DictationDraft(text: "keep", caret: 2)
    #expect(draft.merged("  ").text == "keep")
    #expect(draft.original == "keep")
  }

  @Test("a caret past the end or inside an emoji stays on a character boundary")
  func clamps() {
    #expect(DictationDraft(text: "hi", caret: 99).prefix == "hi")
    #expect(DictationDraft(text: "a😀b", caret: 2).prefix == "a")
  }
}

@MainActor
@Suite("Composer dictation")
struct ComposerDictationTests {
  private let host = FakeComposerHost()

  private func model(_ engine: FakeDictationEngine) -> ComposerModel {
    host.statusByAgent["a1"] = nil
    return ComposerModel(
      agentId: "a1", sessionId: "s1", host: host, style: .phone,
      preferences: Preferences(suiteName: "dictation-\(UUID().uuidString)"), dictationEngine: { engine })
  }

  @Test("partials fill the draft, the final transcript stays for review and nothing is sent")
  func dictates() async {
    let engine = FakeDictationEngine(final: "run the tests")
    let composer = model(engine)
    var affordances: [ChatInputAffordance] = []
    composer.onAffordance = { affordances.append($0) }
    composer.text = "please"
    composer.caret = 6
    composer.startDictation()
    #expect(composer.dictation == .starting)
    await settle()
    #expect(composer.dictation == .listening)
    #expect(!composer.canSend())
    engine.say("run the")
    await settle()
    #expect(composer.text == "please run the")
    composer.stopDictation()
    await settle()
    #expect(composer.dictation == .idle)
    #expect(composer.text == "please run the tests")
    #expect(host.sent.isEmpty)
    #expect(affordances == [.dictation])
    #expect(composer.canSend())
  }

  @Test("a stop during start waits for the microphone, then finishes")
  func stopWhileStarting() async {
    let engine = FakeDictationEngine(final: "")
    let composer = model(engine)
    composer.text = "keep me"
    composer.startDictation(via: .pushToTalk)
    composer.stopDictation()
    await settle()
    #expect(composer.dictation == .idle)
    #expect(composer.text == "keep me")
    #expect(engine.stops == 1)
  }

  @Test("a refusal surfaces and can be dismissed")
  func fails() async {
    let engine = FakeDictationEngine(final: "", error: .microphoneDenied)
    let composer = model(engine)
    composer.startDictation()
    await settle()
    guard case .failed(let message) = composer.dictation else {
      Issue.record("expected a failure")
      return
    }
    #expect(message.contains("microphone"))
    composer.dismissDictationError()
    #expect(composer.dictation == .idle)
  }

  private func settle() async {
    for _ in 0..<20 { await Task.yield() }
  }
}

final class FakeDictationEngine: DictationEngine, @unchecked Sendable {
  private let final: String
  private let error: DictationError?
  private var onTranscript: (@Sendable (String) -> Void)?
  private(set) var stops = 0

  init(final: String, error: DictationError? = nil) {
    self.final = final
    self.error = error
  }

  func start(onTranscript: @escaping @Sendable (String) -> Void) async throws {
    if let error { throw error }
    self.onTranscript = onTranscript
  }

  func say(_ words: String) { onTranscript?(words) }

  func stop() async -> String {
    stops += 1
    return final
  }
}
