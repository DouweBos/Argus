@preconcurrency import AVFoundation
import Foundation
@preconcurrency import Speech

/// `SpeechAnalyzer`'s transcriber: on-device only, no time limit.
@available(iOS 26, macOS 26, *)
final class AnalyzerDictationEngine: DictationEngine, @unchecked Sendable {
  private let microphone = MicrophoneCapture()
  private let lock = NSLock()
  private var analyzer: SpeechAnalyzer?
  private var input: AsyncStream<AnalyzerInput>.Continuation?
  private var results: Task<Void, Never>?
  private var finalized = ""
  private var volatile = ""

  private var transcript: String { lock.withLock { finalized + volatile } }

  func start(onTranscript: @escaping @Sendable (String) -> Void) async throws {
    guard SpeechTranscriber.isAvailable else { throw DictationError.modelUnavailable }
    guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale.current) else {
      throw DictationError.unsupportedLanguage
    }
    try await MicrophoneCapture.requestAccess()
    let transcriber = SpeechTranscriber(
      locale: locale, transcriptionOptions: [], reportingOptions: [.volatileResults], attributeOptions: [])
    do {
      // A no-op once installed; offline, a missing model can't download and the fallback takes over.
      if let install = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
        try await install.downloadAndInstall()
      }
    } catch {
      throw DictationError.modelUnavailable
    }
    let analyzer = SpeechAnalyzer(modules: [transcriber])
    let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber])
    let (stream, input) = AsyncStream<AnalyzerInput>.makeStream()
    let results = Task { [weak self] in
      do {
        for try await result in transcriber.results {
          guard let self else { return }
          let text = String(result.text.characters)
          self.lock.withLock {
            if result.isFinal {
              self.finalized += text
              self.volatile = ""
            } else {
              self.volatile = text
            }
          }
          onTranscript(self.transcript)
        }
      } catch {}
    }
    lock.withLock {
      self.analyzer = analyzer
      self.input = input
      self.results = results
    }
    do {
      try await analyzer.start(inputSequence: stream)
      try microphone.start(convertingTo: format) { input.yield(AnalyzerInput(buffer: $0)) }
    } catch {
      _ = await stop()
      throw error as? DictationError ?? .failed(error.localizedDescription)
    }
  }

  func stop() async -> String {
    microphone.stop()
    let (analyzer, input, results) = lock.withLock { (self.analyzer, self.input, self.results) }
    input?.finish()
    try? await analyzer?.finalizeAndFinishThroughEndOfInput()
    await results?.value
    let text = transcript
    lock.withLock {
      self.analyzer = nil
      self.input = nil
      self.results = nil
      finalized = ""
      volatile = ""
    }
    return text
  }
}

/// `SFSpeechRecognizer` held to its on-device model, for systems before `SpeechAnalyzer`
/// and languages it doesn't cover yet.
final class RecognizerDictationEngine: DictationEngine, @unchecked Sendable {
  private let microphone = MicrophoneCapture()
  private let lock = NSLock()
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var latest = ""
  private var done: CheckedContinuation<Void, Never>?
  private var finished = false

  func start(onTranscript: @escaping @Sendable (String) -> Void) async throws {
    try await Self.requestAuthorization()
    guard let recognizer = SFSpeechRecognizer(locale: Locale.current) else { throw DictationError.unsupportedLanguage }
    guard recognizer.supportsOnDeviceRecognition else { throw DictationError.modelUnavailable }
    try await MicrophoneCapture.requestAccess()
    let request = SFSpeechAudioBufferRecognitionRequest()
    request.requiresOnDeviceRecognition = true
    request.shouldReportPartialResults = true
    request.addsPunctuation = true
    lock.withLock {
      latest = ""
      finished = false
      self.request = request
    }
    let task = recognizer.recognitionTask(with: request) { [weak self] result, error in
      guard let self else { return }
      if let result {
        let text = result.bestTranscription.formattedString
        self.lock.withLock { self.latest = text }
        onTranscript(text)
      }
      if error != nil || result?.isFinal == true { self.finish() }
    }
    lock.withLock { self.task = task }
    do {
      try microphone.start(convertingTo: nil) { request.append($0) }
    } catch {
      task.cancel()
      throw error
    }
  }

  func stop() async -> String {
    microphone.stop()
    let (request, task) = lock.withLock { (self.request, self.task) }
    guard let request, let task else { return "" }
    request.endAudio()
    // The last words arrive shortly after the audio ends; don't hang on a recognizer that never says it's final.
    let timeout = Task { [weak self] in
      try? await Task.sleep(for: .seconds(2))
      self?.finish()
    }
    await withCheckedContinuation { continuation in
      let alreadyDone = lock.withLock { () -> Bool in
        if finished { return true }
        done = continuation
        return false
      }
      if alreadyDone { continuation.resume() }
    }
    timeout.cancel()
    task.cancel()
    return lock.withLock {
      self.request = nil
      self.task = nil
      return latest
    }
  }

  private func finish() {
    let continuation = lock.withLock { () -> CheckedContinuation<Void, Never>? in
      finished = true
      defer { done = nil }
      return done
    }
    continuation?.resume()
  }

  private static func requestAuthorization() async throws {
    let status = await withCheckedContinuation { continuation in
      SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
    }
    guard status == .authorized else { throw DictationError.speechDenied }
  }
}
