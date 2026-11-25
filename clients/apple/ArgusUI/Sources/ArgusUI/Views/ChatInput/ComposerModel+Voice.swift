import ArgusCore
import ArgusKit
import Foundation

/// What voice mode reacts to: a finished turn's reply, or a decision the agent is waiting on.
public struct VoiceCue: Equatable, Sendable {
  public enum Kind: Sendable {
    case reply(String)
    /// Allow / deny, answered aloud.
    case permission(RemoteToolCall)
    /// A question, plan or secret, which only the screen can answer.
    case onScreen(String)
  }

  public let id: String
  public let kind: Kind

  public static func == (lhs: VoiceCue, rhs: VoiceCue) -> Bool { lhs.id == rhs.id }
}

/// What a voice-mode listen is for.
enum VoiceListen: Equatable {
  case prompt
  case answer(toolUseId: String)
}

/// What voice mode needs from the device, injectable for tests.
public struct VoiceEnvironment {
  let synthesizer: @MainActor () -> any SpeechSynthesizer
  let isForeground: @MainActor () -> Bool
  /// Silence after speech that sends it.
  let pause: Duration
  /// Silence with nothing said that closes the microphone.
  let giveUp: Duration
  let sleep: @MainActor (Duration) async -> Void

  public init(
    synthesizer: @escaping @MainActor () -> any SpeechSynthesizer, isForeground: @escaping @MainActor () -> Bool,
    pause: Duration = .milliseconds(1600), giveUp: Duration = .seconds(30),
    sleep: @escaping @MainActor (Duration) async -> Void = { try? await Task.sleep(for: $0) }
  ) {
    self.synthesizer = synthesizer
    self.isForeground = isForeground
    self.pause = pause
    self.giveUp = giveUp
    self.sleep = sleep
  }

  @MainActor public static let live = VoiceEnvironment(
    synthesizer: { SystemSpeechSynthesizer() }, isForeground: { AppActivity.isForeground })
}

/// Hands-free: a finished turn's reply is read aloud, then the microphone opens and a pause sends what was said.
/// Permission prompts are read too, and a spoken "allow" or "deny" answers them.
extension ComposerModel {
  /// Changes whenever there's something new to say; the views hand it back through `voiceCueChanged()`.
  public var voiceCue: VoiceCue? {
    guard voiceMode, starter == nil else { return nil }
    let messages = host.visibleMessages(for: agentId)
    if let call = host.pendingCalls(agentKey: agentId, in: messages).first {
      if case .buttons = PendingForm.of(name: call.name, input: call.input) {
        return VoiceCue(id: "prompt:\(call.id)", kind: .permission(call))
      }
      return VoiceCue(id: "prompt:\(call.id)", kind: .onScreen(PendingPrompts.title(for: call)))
    }
    guard status?.status == .idle else { return nil }
    for message in messages.reversed() {
      if message.role == .user { return nil }
      let text = message.textBlocks.joined(separator: "\n\n").trimmingCharacters(in: .whitespacesAndNewlines)
      if message.role == .assistant, message.isError != true, !text.isEmpty {
        return VoiceCue(id: "reply:\(message.id)", kind: .reply(text))
      }
    }
    return nil
  }

  public func toggleVoiceMode() { setVoiceMode(!voiceMode) }

  public func setVoiceMode(_ on: Bool) {
    guard on != voiceMode else { return }
    voiceMode = on
    VoiceSettings.setMode(on, preferences)
    guard on else { return stopVoice() }
    onAffordance?(.voiceMode)
    // A waiting prompt is read; a reply already on screen isn't, and the microphone opens for the next prompt.
    switch voiceCue?.kind {
    case .permission, .onScreen:
      voiceCueChanged()
    case .reply:
      voiceHandledCue = voiceCue?.id
      listen(for: .prompt)
    case nil:
      if !isRunning { listen(for: .prompt) }
    }
  }

  /// A turn started here; its reply is read when it ends. A reply that was already there when the agent opened isn't.
  public func voiceTurnStarted() {
    if voiceMode { voiceArmed = true }
  }

  public func voiceCueChanged() {
    guard voiceMode, let cue = voiceCue, cue.id != voiceHandledCue else { return }
    if case .reply = cue.kind, !voiceArmed { return }
    voiceHandledCue = cue.id
    voiceArmed = false
    voiceTask?.cancel()
    voiceTask = Task { [weak self] in await self?.run(cue) }
  }

  /// Quiet and off the microphone; voice mode itself stays as it was. Words already heard stay in the draft.
  public func stopVoice() {
    voiceTask?.cancel()
    voiceTimer?.cancel()
    voiceSynthesizer?.stop()
    speaking = false
    if dictationRun?.listen != nil { stopDictation() }
  }

  private func run(_ cue: VoiceCue) async {
    voiceSynthesizer?.stop()
    // The user's own words stay in the draft; nothing half-said is sent.
    await endDictation()
    guard !Task.isCancelled, voiceMode else { return }
    switch cue.kind {
    case .reply(let text):
      listen(for: .prompt)
      await say(SpokenText.reply(text))
    case .permission(let call):
      listen(for: .answer(toolUseId: call.id))
      await say(SpokenText.permission(name: call.name, input: call.input))
    case .onScreen(let title):
      await say(SpokenText.onScreen(title))
    }
  }

  /// Opens the microphone first so the user can talk over the reply.
  private func listen(for purpose: VoiceListen) {
    startDictation(via: .voice)
    guard let run = dictationRun, run.trigger == .voice else { return }
    run.listen = purpose
    armVoiceTimer(run, after: voice.giveUp)
  }

  private func say(_ text: String) async {
    let settings = VoiceSettings.load(preferences)
    guard !text.isEmpty, !(settings.onlyInBackground && voice.isForeground()) else { return }
    let synthesizer = voiceSynthesizer ?? voice.synthesizer()
    voiceSynthesizer = synthesizer
    let run = dictationRun
    run?.echo = text
    speaking = true
    await synthesizer.speak(text, settings: settings)
    // Played out: all heard so far was the reply. Talked over: the barge-in already counted it.
    if speaking, let run { run.echoWords = SpokenText.words(run.latest).count }
    speaking = false
    // Silence is counted from the end of the reply, not its start.
    if let run = dictationRun, run.listen != nil, !run.heard { armVoiceTimer(run, after: voice.giveUp) }
  }

  // MARK: Dictation hooks

  /// The transcript as voice mode wants it in the draft: nil while it's only the reply's own echo.
  func voiceHeard(_ transcript: String, in run: DictationRun) -> String? {
    guard run.listen != nil else { return transcript }
    run.latest = transcript
    if speaking, let echo = run.echo {
      guard !SpokenText.novelWords(in: transcript, spoken: echo).isEmpty else { return nil }
      // The user started talking: the reply stops for them.
      run.echoWords = SpokenText.echoLength(transcript, spoken: echo)
      voiceSynthesizer?.stop()
      speaking = false
    }
    let transcript = SpokenText.dropping(run.echoWords, wordsOf: transcript)
    guard !transcript.isEmpty else { return nil }
    run.heard = true
    armVoiceTimer(run, after: voice.pause)
    return transcript
  }

  /// Dictation's last words are in; send them or answer with them. Returns whether the draft should keep them.
  func voiceFinished(_ run: DictationRun, transcript: String) -> Bool {
    guard let purpose = run.listen, run.voiceSend else { return true }
    switch purpose {
    case .prompt:
      return true
    case .answer(let toolUseId):
      guard let answer = SpokenText.answer(transcript) else {
        voiceTask = Task { [weak self] in
          guard let self, voiceMode else { return }
          listen(for: .answer(toolUseId: toolUseId))
          await say(SpokenText.repeatAnswer)
        }
        return false
      }
      onAffordance?(.voiceAnswer)
      Task {
        await host.respond(
          agentId: agentId, toolUseId: toolUseId, decision: answer == .allow ? "allow" : "deny", message: nil,
          alwaysAllow: nil, fromNotification: false)
      }
      return false
    }
  }

  /// After the words landed: a spoken prompt goes out.
  func voiceSendIfDone(_ run: DictationRun) {
    guard run.listen == .prompt, run.voiceSend, canSend() else { return }
    onAffordance?(.voiceSend)
    submit()
  }

  private func armVoiceTimer(_ run: DictationRun, after delay: Duration) {
    voiceTimer?.cancel()
    let sleep = voice.sleep
    voiceTimer = Task { [weak self] in
      await sleep(delay)
      guard !Task.isCancelled, let self, dictationRun?.id == run.id, !speaking else { return }
      // Heard something: the pause sends it. Heard nothing: the microphone closes.
      run.voiceSend = run.heard
      stopDictation()
    }
  }
}
