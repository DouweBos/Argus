@preconcurrency import AVFoundation
import Foundation

/// Text to speech, on the device.
@MainActor
public protocol SpeechSynthesizer: AnyObject {
  /// Returns once the text has been spoken or `stop()` cut it off.
  func speak(_ text: String, settings: VoiceSettings) async
  func stop()
}

/// `AVSpeechSynthesizer`, one utterance at a time.
@MainActor
public final class SystemSpeechSynthesizer: NSObject, SpeechSynthesizer {
  private let synthesizer = AVSpeechSynthesizer()
  private var finished: CheckedContinuation<Void, Never>?

  override public init() {
    super.init()
    synthesizer.delegate = self
  }

  public func speak(_ text: String, settings: VoiceSettings) async {
    stop()
    let utterance = AVSpeechUtterance(string: text)
    utterance.voice =
      settings.voiceId.flatMap(AVSpeechSynthesisVoice.init(identifier:))
      ?? AVSpeechSynthesisVoice(language: Locale.current.identifier(.bcp47))
    let speed = min(max(settings.speed, VoiceSettings.speeds.lowerBound), VoiceSettings.speeds.upperBound)
    utterance.rate = min(
      max(AVSpeechUtteranceDefaultSpeechRate * Float(speed), AVSpeechUtteranceMinimumSpeechRate),
      AVSpeechUtteranceMaximumSpeechRate)
    await withCheckedContinuation { continuation in
      finished = continuation
      synthesizer.speak(utterance)
    }
  }

  public func stop() {
    if synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .immediate) }
    resume()
  }

  private func resume() {
    let continuation = finished
    finished = nil
    continuation?.resume()
  }
}

extension SystemSpeechSynthesizer: @preconcurrency AVSpeechSynthesizerDelegate {
  public func speechSynthesizer(_: AVSpeechSynthesizer, didFinish _: AVSpeechUtterance) { resume() }
  public func speechSynthesizer(_: AVSpeechSynthesizer, didCancel _: AVSpeechUtterance) { resume() }
}
