import Foundation

public enum DictationPhase: Equatable, Sendable {
  case idle
  /// Asking for permission, loading the model, opening the microphone.
  case starting
  case listening
  /// Waiting for the last words after the microphone closed.
  case finishing
  case failed(String)

  /// The draft is the transcript's until this ends.
  public var isActive: Bool {
    switch self {
    case .starting, .listening, .finishing: true
    case .idle, .failed: false
    }
  }
}

/// How dictation was started, which the telemetry tells apart.
public enum DictationTrigger: Sendable {
  case button
  /// The Mac's hold-to-talk key.
  case pushToTalk
  /// Voice mode, which counts its own sends and answers.
  case voice

  var affordance: ChatInputAffordance? {
    switch self {
    case .button: .dictation
    case .pushToTalk: .dictationShortcut
    case .voice: nil
    }
  }
}

/// One stretch of listening: where its words land and who's doing the listening.
@MainActor
final class DictationRun {
  let id = UUID()
  let engine: any DictationEngine
  let draft: DictationDraft
  let trigger: DictationTrigger
  var stopRequested = false
  /// Set: voice mode is listening, for a prompt or a permission answer.
  var listen: VoiceListen?
  /// What was read aloud while this run listened, which the microphone hears too.
  var echo: String?
  /// The transcript's first words that were that echo, once the reply ended or was talked over.
  var echoWords = 0
  /// The transcript as last heard, echo and all.
  var latest = ""
  /// The user has said something past the echo.
  var heard = false
  /// A pause ended it, so what was said is sent rather than left for review.
  var voiceSend = false

  init(engine: any DictationEngine, draft: DictationDraft, trigger: DictationTrigger) {
    self.engine = engine
    self.draft = draft
    self.trigger = trigger
  }
}

/// Dictation into the draft, on-device. Words land at the caret for review and are never sent.
extension ComposerModel {
  public func toggleDictation(via trigger: DictationTrigger = .button) {
    dictation.isActive ? stopDictation() : startDictation(via: trigger)
  }

  public func startDictation(via trigger: DictationTrigger = .button) {
    guard isEnabled, !dictation.isActive else { return }
    let run = DictationRun(
      engine: makeDictationEngine(voiceMode), draft: DictationDraft(text: text, caret: editor?.caret ?? caret), trigger: trigger)
    dictationRun = run
    dictation = .starting
    Task { [weak self] in
      do {
        try await run.engine.start { [weak self] transcript in
          Task { @MainActor in self?.heard(transcript, in: run.id) }
        }
      } catch {
        guard let self, dictationRun?.id == run.id else { return }
        dictationRun = nil
        dictation = .failed((error as? LocalizedError)?.errorDescription ?? error.localizedDescription)
        return
      }
      // The composer went away while the microphone opened.
      guard let self else { return _ = await run.engine.stop() }
      guard dictationRun?.id == run.id else { return }
      if run.stopRequested {
        await finish(run)
      } else {
        dictation = .listening
      }
    }
  }

  /// Takes the words heard so far; a start still underway stops as soon as it's listening.
  public func stopDictation() {
    guard let run = dictationRun else { return }
    guard dictation == .listening else {
      run.stopRequested = true
      return
    }
    Task { await finish(run) }
  }

  /// Stops and waits until the words are in.
  func endDictation() async {
    guard let run = dictationRun else { return }
    if dictation == .listening { return await finish(run) }
    stopDictation()
    for _ in 0..<300 where dictationRun?.id == run.id { try? await Task.sleep(for: .milliseconds(10)) }
  }

  public func dismissDictationError() {
    if case .failed = dictation { dictation = .idle }
  }

  private func heard(_ transcript: String, in runId: UUID) {
    guard let run = dictationRun, run.id == runId, dictation.isActive,
      let transcript = voiceHeard(transcript, in: run)
    else { return }
    // Straight to the binding, not the editor: the partials shouldn't each be an undo step.
    let merged = run.draft.merged(transcript)
    text = merged.text
    caret = merged.caret
  }

  private func finish(_ run: DictationRun) async {
    dictation = .finishing
    var transcript = await run.engine.stop()
    guard dictationRun?.id == run.id else { return }
    dictationRun = nil
    dictation = .idle
    let original = run.draft.original
    editor?.restore(original)
    text = original
    transcript = SpokenText.dropping(run.echoWords, wordsOf: transcript)
    guard !transcript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      voiceFinished(run, transcript: transcript)
    else { return }
    let merged = run.draft.merged(transcript)
    // One undoable edit from the draft as it was to the draft with the words in.
    replaceText(merged.text, caret: merged.caret)
    if let affordance = run.trigger.affordance { onAffordance?(affordance) }
    voiceSendIfDone(run)
    if style == .desktop || run.trigger != .voice { editor?.focus() }
  }
}
