import ArgusKit
import Foundation
import Testing

@testable import ArgusUI

@Suite("SpokenText")
struct SpokenTextTests {
  @Test("code and tables are skipped, markdown and links read as words")
  func reply() {
    let markdown = """
      ## Done

      I fixed **the build** in `Package.swift`. See [the PR](https://example.com/pr/1).

      ```swift
      let x = 1
      ```

      | a | b |
      |---|---|
      | 1 | 2 |

      - Tests pass
      1. Ship it
      Docs at https://example.com/docs
      """
    #expect(
      SpokenText.reply(markdown)
        == "Done. I fixed the build in Package.swift. See the PR. Code is on screen. A table is on screen. "
        + "Tests pass. Ship it. Docs at a link.")
  }

  @Test("a long reply stops at a sentence and points at the screen")
  func long() {
    let reply = SpokenText.reply(String(repeating: "This is a sentence. ", count: 200))
    #expect(reply.count < SpokenText.replyLimit + 40)
    #expect(reply.hasSuffix("sentence. The rest is on screen."))
  }

  @Test("permission prompts name what the agent wants to do")
  func permission() {
    #expect(
      SpokenText.permission(name: "Bash", input: ["command": .string("pnpm test")])
        == "The agent wants to run pnpm test. Allow or deny?")
    #expect(
      SpokenText.permission(name: "Edit", input: ["file_path": .string("/repo/src/app.ts")])
        == "The agent wants to edit app.ts. Allow or deny?")
    #expect(SpokenText.permission(name: "mcp__linear__get_issue", input: [:]).contains("use issue"))
    #expect(
      SpokenText.permission(name: "Bash", input: ["command": .string(String(repeating: "x", count: 200))])
        .contains("run a long command"))
  }

  @Test("only a whole-utterance answer counts")
  func answers() {
    #expect(SpokenText.answer("Allow.") == .allow)
    #expect(SpokenText.answer("yes please") == .allow)
    #expect(SpokenText.answer("Deny") == .deny)
    #expect(SpokenText.answer("No.") == .deny)
    #expect(SpokenText.answer("no I want you to run the tests first") == nil)
    #expect(SpokenText.answer("") == nil)
  }

  @Test("the reply's own echo is told apart from the user")
  func echo() {
    let spoken = "I fixed the build. Tests pass."
    #expect(SpokenText.novelWords(in: "fixed the build", spoken: spoken).isEmpty)
    #expect(SpokenText.novelWords(in: "fixed the wait stop", spoken: spoken) == ["wait", "stop"])
    #expect(SpokenText.echoLength("I fixed the build now run the tests", spoken: spoken) == 4)
    #expect(SpokenText.echoLength("tests pass", spoken: spoken) == 2)
    #expect(SpokenText.dropping(4, wordsOf: "I fixed the build now run the tests") == "now run the tests")
  }
}

@MainActor
@Suite("Composer voice mode")
struct ComposerVoiceTests {
  private let host = FakeComposerHost()
  private let engine = FakeDictationEngine(final: nil)
  private let speaker = FakeSpeaker()
  private let clock = ManualClock()

  private func model(
    foreground: Bool = false, onlyInBackground: Bool = false, giveUp: Duration = .seconds(30)
  ) -> ComposerModel {
    let preferences = Preferences(suiteName: "voice-\(UUID().uuidString)")
    VoiceSettings(voiceId: nil, speed: 1, onlyInBackground: onlyInBackground).save(preferences)
    host.statusByAgent["a1"] = status(.idle)
    let engine = engine
    let speaker = speaker
    let clock = clock
    return ComposerModel(
      agentId: "a1", sessionId: "s1", host: host, style: .phone, preferences: preferences,
      dictationEngine: { _ in engine },
      voice: VoiceEnvironment(
        synthesizer: { speaker }, isForeground: { foreground }, pause: .seconds(1), giveUp: giveUp,
        sleep: { await clock.sleep($0) }))
  }

  /// The agent runs a turn and ends it with `reply`.
  private func finishTurn(_ composer: ComposerModel, reply: String) {
    host.statusByAgent["a1"] = status(.running)
    composer.voiceTurnStarted()
    host.messagesByAgent["a1", default: []].append(
      RemoteMessage(id: UUID().uuidString, role: .assistant, textBlocks: [reply]))
    host.statusByAgent["a1"] = status(.idle)
    composer.voiceCueChanged()
  }

  @Test("turning it on opens the microphone; a pause sends what was said")
  func sendsOnPause() async {
    let composer = model()
    var affordances: [ChatInputAffordance] = []
    composer.onAffordance = { affordances.append($0) }
    composer.setVoiceMode(true)
    await settle()
    #expect(composer.dictation == .listening)
    engine.say("run the tests")
    await settle()
    #expect(composer.text == "run the tests")
    await clock.advance(by: .seconds(1))
    #expect(host.sent.map(\.message) == ["run the tests"])
    #expect(composer.text.isEmpty)
    #expect(affordances == [.voiceMode, .voiceSend])
  }

  @Test("a finished turn's reply is read aloud, then the microphone opens again")
  func readsReply() async {
    let composer = model()
    composer.setVoiceMode(true)
    await settle()
    engine.say("hi")
    await clock.advance(by: .seconds(1))
    finishTurn(composer, reply: "All **done**.\n\n```\ncode\n```")
    await settle()
    #expect(speaker.spoken == ["All done. Code is on screen."])
    #expect(composer.dictation == .listening)
    #expect(engine.starts == 2)
  }

  @Test("a reply already on screen when the agent opens isn't read")
  func skipsOldReply() async {
    host.messagesByAgent["a1"] = [RemoteMessage(id: "m0", role: .assistant, textBlocks: ["Earlier."])]
    let composer = model()
    composer.setVoiceMode(true)
    composer.voiceCueChanged()
    await settle()
    #expect(speaker.spoken.isEmpty)
    #expect(composer.dictation == .listening)
  }

  @Test("talking over the reply stops it, and only the user's words land")
  func bargeIn() async {
    let composer = model()
    composer.setVoiceMode(true)
    await settle()
    speaker.holds = true
    finishTurn(composer, reply: "I fixed the build.")
    await settle()
    #expect(composer.speaking)
    engine.say("fixed the build")
    await settle()
    #expect(composer.speaking)
    #expect(composer.text.isEmpty)
    engine.say("fixed the build wait run it again")
    await settle()
    #expect(!composer.speaking)
    #expect(speaker.stops > 0)
    #expect(composer.text == "wait run it again")
  }

  @Test("a permission prompt is read, and a spoken allow answers it")
  func answersPermission() async throws {
    let composer = model()
    var affordances: [ChatInputAffordance] = []
    composer.onAffordance = { affordances.append($0) }
    composer.setVoiceMode(true)
    await settle()
    host.pending = [try call(id: "t1", name: "Bash", input: #"{"command":"pnpm test"}"#)]
    composer.voiceCueChanged()
    await settle()
    #expect(speaker.spoken.last == "The agent wants to run pnpm test. Allow or deny?")
    engine.say("Allow.")
    await clock.advance(by: .seconds(1))
    #expect(host.decisions.map(\.decision) == ["allow"])
    #expect(host.sent.isEmpty)
    #expect(composer.text.isEmpty)
    #expect(affordances.contains(.voiceAnswer))
  }

  @Test("an unclear answer is asked again, not sent as a message")
  func unclearAnswer() async throws {
    let composer = model()
    composer.setVoiceMode(true)
    await settle()
    host.pending = [try call(id: "t1", name: "Bash", input: #"{"command":"ls"}"#)]
    composer.voiceCueChanged()
    await settle()
    engine.say("maybe later")
    await clock.advance(by: .seconds(1))
    #expect(host.decisions.isEmpty)
    #expect(host.sent.isEmpty)
    #expect(speaker.spoken.last == SpokenText.repeatAnswer)
    #expect(composer.dictation == .listening)
  }

  @Test("only-in-background stays quiet in front but still listens")
  func quietInFront() async {
    let composer = model(foreground: true, onlyInBackground: true)
    composer.setVoiceMode(true)
    await settle()
    engine.say("hi")
    await clock.advance(by: .seconds(1))
    finishTurn(composer, reply: "Done.")
    await settle()
    #expect(speaker.spoken.isEmpty)
    #expect(composer.dictation == .listening)
  }

  @Test("silence closes the microphone without sending; turning it off stops speech")
  func givesUp() async {
    let composer = model()
    composer.setVoiceMode(true)
    await settle()
    await clock.advance(by: .seconds(30))
    #expect(composer.dictation == .idle)
    #expect(host.sent.isEmpty)
    #expect(composer.voiceMode)
    speaker.holds = true
    composer.toggleVoiceMode()
    #expect(!composer.voiceMode)
    #expect(!composer.speaking)
  }

  private func status(_ state: RemoteAgentState) -> RemoteAgentStatus {
    let json = #"{"agent_id":"a1","session_id":"s1","status":"\#(state.rawValue)"}"#
    return try! JSONDecoder().decode(RemoteAgentStatus.self, from: Data(json.utf8))
  }

  private func call(id: String, name: String, input: String) throws -> RemoteToolCall {
    let json = #"{"id":"\#(id)","name":"\#(name)","input":\#(input),"result_blocks":[],"status":"pending"}"#
    return try JSONDecoder().decode(RemoteToolCall.self, from: Data(json.utf8))
  }

  private func settle() async {
    for _ in 0..<40 { await Task.yield() }
  }
}

/// Sleeps that end only when the test moves time on.
@MainActor
final class ManualClock {
  private var now = Duration.zero
  private var waiters: [(deadline: Duration, continuation: CheckedContinuation<Void, Never>)] = []

  func sleep(_ delay: Duration) async {
    await withCheckedContinuation { waiters.append((now + delay, $0)) }
  }

  func advance(by delay: Duration) async {
    for _ in 0..<40 { await Task.yield() }
    now += delay
    let due = waiters.filter { $0.deadline <= now }
    waiters.removeAll { $0.deadline <= now }
    due.forEach { $0.continuation.resume() }
    for _ in 0..<40 { await Task.yield() }
  }
}

@MainActor
final class FakeSpeaker: SpeechSynthesizer {
  private(set) var spoken: [String] = []
  private(set) var stops = 0
  /// Keeps speaking until stopped, to talk over it.
  var holds = false
  private var pending: CheckedContinuation<Void, Never>?

  func speak(_ text: String, settings: VoiceSettings) async {
    spoken.append(text)
    guard holds else { return }
    await withCheckedContinuation { pending = $0 }
  }

  func stop() {
    stops += 1
    pending?.resume()
    pending = nil
  }
}
