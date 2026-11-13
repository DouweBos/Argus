@preconcurrency import AVFoundation
import Foundation

/// The microphone as a stream of PCM buffers, converted to the format a recognizer wants.
/// Nonisolated on purpose: the tap runs on the audio thread.
final class MicrophoneCapture: @unchecked Sendable {
  private let engine = AVAudioEngine()
  private let lock = NSLock()
  private var running = false

  static func requestAccess() async throws {
    guard await AVAudioApplication.requestRecordPermission() else { throw DictationError.microphoneDenied }
  }

  /// `format` nil keeps the microphone's own.
  func start(convertingTo format: AVAudioFormat?, onBuffer: @escaping @Sendable (AVAudioPCMBuffer) -> Void) throws {
    #if os(iOS)
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.record, mode: .measurement, options: .duckOthers)
      try session.setActive(true, options: .notifyOthersOnDeactivation)
    #endif
    let input = engine.inputNode
    let source = input.outputFormat(forBus: 0)
    guard source.sampleRate > 0, source.channelCount > 0 else { throw DictationError.failed("No microphone is connected.") }
    let converter = format.flatMap { $0 == source ? nil : AVAudioConverter(from: source, to: $0) }
    input.installTap(onBus: 0, bufferSize: 4096, format: source) { buffer, _ in
      guard let converter, let format else { return onBuffer(buffer) }
      if let converted = Self.convert(buffer, with: converter, to: format) { onBuffer(converted) }
    }
    engine.prepare()
    do {
      try engine.start()
    } catch {
      input.removeTap(onBus: 0)
      throw DictationError.failed(error.localizedDescription)
    }
    lock.withLock { running = true }
  }

  func stop() {
    guard lock.withLock({ () -> Bool in
      defer { running = false }
      return running
    }) else { return }
    engine.stop()
    engine.inputNode.removeTap(onBus: 0)
    #if os(iOS)
      try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    #endif
  }

  private static func convert(
    _ buffer: AVAudioPCMBuffer, with converter: AVAudioConverter, to format: AVAudioFormat
  ) -> AVAudioPCMBuffer? {
    let ratio = format.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up))
    guard capacity > 0, let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return nil }
    var consumed = false
    var error: NSError?
    let status = converter.convert(to: output, error: &error) { _, outStatus in
      if consumed {
        outStatus.pointee = .noDataNow
        return nil
      }
      consumed = true
      outStatus.pointee = .haveData
      return buffer
    }
    return status == .error || output.frameLength == 0 ? nil : output
  }
}
