import Foundation

/// Speech to text from the microphone, entirely on the device.
public protocol DictationEngine: AnyObject, Sendable {
  /// Listens until `stop()`; `onTranscript` gets the whole transcript so far, from any thread, each time it changes.
  func start(onTranscript: @escaping @Sendable (String) -> Void) async throws
  /// Stops listening, waits for the last words, and returns the final transcript.
  func stop() async -> String
}

public enum DictationError: LocalizedError, Equatable {
  case microphoneDenied
  case speechDenied
  case unsupportedLanguage
  /// The on-device model isn't installed, and nothing is sent off the device instead.
  case modelUnavailable
  case failed(String)

  private static var settingsApp: String {
    #if os(macOS)
      "System Settings"
    #else
      "Settings"
    #endif
  }

  public var errorDescription: String? {
    switch self {
    case .microphoneDenied:
      "Turn on microphone access for Argus in \(Self.settingsApp)."
    case .speechDenied:
      "Turn on speech recognition for Argus in \(Self.settingsApp)."
    case .unsupportedLanguage:
      "On-device dictation doesn't support your language yet."
    case .modelUnavailable:
      "Go online once so the on-device speech model can download."
    case .failed(let message):
      "Dictation stopped: \(message)"
    }
  }
}

/// The engines this device can run, best first.
public enum DictationEngines {
  public static func live() -> any DictationEngine {
    if #available(iOS 26, macOS 26, *) {
      return FallbackDictationEngine(primary: AnalyzerDictationEngine(), fallback: RecognizerDictationEngine())
    }
    return RecognizerDictationEngine()
  }
}

/// `SpeechAnalyzer` where its model is installed, else the older recognizer's on-device model.
final class FallbackDictationEngine: DictationEngine, @unchecked Sendable {
  private let primary: any DictationEngine
  private let fallback: any DictationEngine
  private let lock = NSLock()
  private var active: (any DictationEngine)?

  init(primary: any DictationEngine, fallback: any DictationEngine) {
    self.primary = primary
    self.fallback = fallback
  }

  func start(onTranscript: @escaping @Sendable (String) -> Void) async throws {
    do {
      try await primary.start(onTranscript: onTranscript)
      lock.withLock { active = primary }
    } catch DictationError.modelUnavailable, DictationError.unsupportedLanguage {
      try await fallback.start(onTranscript: onTranscript)
      lock.withLock { active = fallback }
    }
  }

  func stop() async -> String {
    guard let engine = lock.withLock({ active }) else { return "" }
    return await engine.stop()
  }
}
